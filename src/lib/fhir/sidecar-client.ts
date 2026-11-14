import type {
  Bundle,
  Coding,
  DocumentReference,
  FhirResource,
  OperationOutcome,
} from 'fhir/r4'
import {
  FhirRequestError,
  NotLaunchedError,
  ScopeRefusedError,
} from '@/lib/fhir/errors'

// The EHR connection of a launched app.
//
// The hosting platform runs a sidecar beside the app. It did the launch from the EHR and it
// alone knows how to reach the clinic. This file asks the sidecar, on this machine only, and
// identifies the visitor by passing on the browser's Cookie header untouched. Nothing here
// knows which clinic it is, where the EHR lives, or how the visitor signed in.

const DEFAULT_SIDECAR = 'http://127.0.0.1:8081'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export const DOCUMENT_KIND_SYSTEM = 'urn:tiro-health:document-kind'
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export type ResourceType = FhirResource['resourceType']
export type ResourceOf<T extends ResourceType> = Extract<
  FhirResource,
  { resourceType: T }
>

/**
 * The search parameters the clinic's FHIR API accepts. Each one matches exactly; a parameter
 * that is not listed is refused by the EHR.
 */
export interface SearchParameters {
  Patient: 'gender' | 'family' | 'given' | 'identifier'
  Encounter: 'status' | 'class'
  DocumentReference: 'patient' | 'subject' | 'identifier'
}

export type SearchParamsOf<T extends ResourceType> =
  T extends keyof SearchParameters
    ? Partial<Record<SearchParameters[T], string>>
    : Record<string, string>

/** What the EHR told the app when it opened it. */
export interface LaunchContext {
  /** Id of the patient whose record was open, or null when launched without one. */
  patient: string | null
  /** Id of the encounter that was open, if any. */
  encounter: string | null
  /** Id of the signed-in practitioner, or null when the EHR did not say who it is. */
  practitioner: string | null
  /** The signed-in user as a FHIR reference, for example "Practitioner/123". */
  fhirUser: string | null
  fhirVersion: string | null
  /** The permissions the clinic granted. May be fewer than the app asked for. */
  scopes: string[]
  intent: string | null
}

export interface NewDocument {
  /** A code from the clinic's document kinds, or a full Coding. */
  type: string | Coding
  title: string
  /** For example "application/pdf" or "text/plain". */
  contentType: string
  /** The file itself: bytes, or text. At most 10 MiB. */
  data: Uint8Array | string
  description?: string
}

type Interaction = 'r' | 's' | 'c'

function sidecarUrl(): string {
  const url = new URL(process.env.EHR_SIDECAR_URL ?? DEFAULT_SIDECAR)
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('EHR_SIDECAR_URL must point at this machine (loopback).')
  }
  return url.origin
}

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== ''
    ? value.slice(value.lastIndexOf('/') + 1)
    : null

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

function checkId(id: string): string {
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) {
    throw new TypeError('Not a valid FHIR id.')
  }
  return id
}

function grants(scopes: string[], type: string, interaction: Interaction) {
  return scopes.some((scope) => {
    const match = /^(?:patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)$/.exec(
      scope,
    )
    if (!match) return false
    const [, resource, rights] = match
    if (resource !== '*' && resource !== type) return false
    const letters = rights === '*' ? 'cruds' : rights === 'read' ? 'rs' : rights
    return letters.includes(interaction)
  })
}

/**
 * Builds the FHIR helper for one request. `cookie` returns the Cookie header of the
 * request being answered; it is passed on as is and never read.
 */
export function createFhirClient(cookie: () => string | undefined) {
  async function send(what: string, path: string, init: RequestInit = {}) {
    const forwarded = cookie()
    if (!forwarded) throw new NotLaunchedError()

    const url = sidecarUrl() + path
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/fhir+json',
          ...init.headers,
          cookie: forwarded,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      // No sidecar beside the app: it was started on its own, so nobody launched it.
      const code = (error as { cause?: { code?: string } }).cause?.code
      if (code === 'ECONNREFUSED') throw new NotLaunchedError()
      throw new FhirRequestError(504, what)
    }
    if (response.status === 401) throw new NotLaunchedError()
    return response
  }

  async function context(): Promise<LaunchContext> {
    const response = await send('Reading the launch context', '/session')
    if (!response.ok) {
      throw new FhirRequestError(response.status, 'Reading the launch context')
    }
    const session = (await response.json()) as Record<string, unknown>
    return {
      patient: idOf(session.patient),
      encounter: idOf(session.encounter),
      practitioner: idOf(session.practitioner),
      fhirUser: text(session.fhirUser),
      fhirVersion: text(session.fhirVersion),
      scopes: Array.isArray(session.scopes) ? session.scopes.map(String) : [],
      intent: text(session.intent),
    }
  }

  async function fhir<T>(
    what: string,
    type: string,
    interaction: Interaction,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await send(what, path, init)
    if (response.ok) return (await response.json()) as T

    const body = (await response.json().catch(() => undefined)) as
      OperationOutcome | undefined
    const outcome = body?.resourceType === 'OperationOutcome' ? body : undefined
    if (response.status === 403) {
      const { scopes } = await context()
      if (!grants(scopes, type, interaction)) {
        const rights = interaction === 'c' ? 'c' : 'rs'
        throw new ScopeRefusedError(`patient/${type}.${rights}`)
      }
    }
    throw new FhirRequestError(response.status, what, outcome)
  }

  /** Reads one resource by its id. */
  function read<T extends ResourceType>(
    type: T,
    id: string,
  ): Promise<ResourceOf<T>> {
    return fhir(`Reading ${type}`, type, 'r', `/fhir/${type}/${checkId(id)}`)
  }

  /**
   * Searches resources of one type. With a patient launch the EHR only returns what belongs
   * to the launched patient. Follows the EHR's pages until `max` resources are collected.
   */
  async function search<T extends ResourceType>(
    type: T,
    params?: SearchParamsOf<T>,
    { max = 200 }: { max?: number } = {},
  ): Promise<ResourceOf<T>[]> {
    const query = new URLSearchParams(params as Record<string, string>)
    let path: string | undefined =
      `/fhir/${type}${query.size ? `?${query}` : ''}`
    const found: ResourceOf<T>[] = []

    while (path && found.length < max) {
      const bundle: Bundle = await fhir(`Searching ${type}`, type, 's', path)
      for (const entry of bundle.entry ?? []) {
        if (entry.resource?.resourceType === type) {
          found.push(entry.resource as ResourceOf<T>)
        }
      }
      // The next page is asked from the sidecar again, wherever the link claims to point.
      const next = bundle.link?.find((link) => link.relation === 'next')?.url
      const target = next ? new URL(next, DEFAULT_SIDECAR) : undefined
      const start = target?.pathname.indexOf('/fhir') ?? -1
      path =
        target && start >= 0
          ? target.pathname.slice(start) + target.search
          : undefined
    }
    return found.slice(0, max)
  }

  /** Creates a resource in the EHR and returns it as stored. */
  function create<R extends FhirResource>(resource: R): Promise<R> {
    const type = resource.resourceType
    return fhir(`Creating ${type}`, type, 'c', `/fhir/${type}`, {
      method: 'POST',
      headers: { 'content-type': 'application/fhir+json' },
      body: JSON.stringify(resource),
    })
  }

  /** Files a document (a PDF, a text, an image) in the launched patient's record. */
  async function createDocumentReference(
    document: NewDocument,
  ): Promise<DocumentReference> {
    const bytes =
      typeof document.data === 'string'
        ? new TextEncoder().encode(document.data)
        : document.data
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new RangeError('The document is larger than 10 MiB.')
    }
    const { patient } = await context()
    if (!patient) throw new NotLaunchedError()

    const coding: Coding =
      typeof document.type === 'string'
        ? { system: DOCUMENT_KIND_SYSTEM, code: document.type }
        : document.type

    // The EHR sets the date itself and refuses a document that carries "date" or "context".
    return create<DocumentReference>({
      resourceType: 'DocumentReference',
      status: 'current',
      type: { coding: [coding] },
      subject: { reference: `Patient/${patient}` },
      description: document.description,
      content: [
        {
          attachment: {
            contentType: document.contentType,
            title: document.title,
            data: Buffer.from(bytes).toString('base64'),
          },
        },
      ],
    })
  }

  return { context, read, search, create, createDocumentReference }
}

export type FhirClient = ReturnType<typeof createFhirClient>
