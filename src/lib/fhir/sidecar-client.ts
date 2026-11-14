import type { Bundle, FhirResource, OperationOutcome } from 'fhir/r4'
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
//
// Nothing here knows a resource type either: which types, interactions and search parameters
// exist is the EHR's to say (`request('GET', 'metadata')` returns its CapabilityStatement).

const DEFAULT_SIDECAR = 'http://127.0.0.1:8081'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export type ResourceType = FhirResource['resourceType']
export type ResourceOf<T extends ResourceType> = Extract<
  FhirResource,
  { resourceType: T }
>

/**
 * Search parameters by name. A list repeats the parameter, which FHIR reads as "all of
 * these"; for "any of these" join the values with a comma in one string.
 */
export type SearchParams = Record<string, string | string[] | undefined>

export interface SearchOptions {
  /** Stop after this many matches. Default 200. */
  max?: number
}

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

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  /**
   * The version the write is based on: `meta.versionId` of the resource as it was read.
   * The EHR refuses an update without it, and one based on an older version.
   */
  version?: string
}

type Interaction = 'r' | 's' | 'c' | 'u' | 'd'

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

function checkId(id: unknown): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9\-.]{1,64}$/.test(id)) {
    throw new TypeError('Not a valid FHIR id.')
  }
  return id
}

function checkType(type: unknown): string {
  if (typeof type !== 'string' || !/^[A-Z][A-Za-z]{0,63}$/.test(type)) {
    throw new TypeError('Not a FHIR resource type.')
  }
  return type
}

/**
 * Turns the path of `request()` into a path under `/fhir/` on the sidecar, or throws. A path
 * is relative ("Patient/123/$everything?_count=10"): no host, no "..", nothing that could
 * reach another address.
 */
function fhirPath(path: string): { path: string; segments: string[] } {
  const [route = '', ...queryParts] = path.split('?')
  const query = queryParts.join('?')
  const segments = route.split('/').filter((segment) => segment !== '')
  const safe =
    !route.startsWith('//') &&
    !/[\s\\#]|[^\x20-\x7e]/.test(path) &&
    segments.every((s) => /^[A-Za-z0-9._$~-]+$/.test(s) && !/^\.+$/.test(s))
  if (!safe) {
    throw new TypeError(
      'Not a FHIR path. Give a path under the FHIR base, such as "Patient/123".',
    )
  }
  const base = segments.length ? `/fhir/${segments.join('/')}` : '/fhir'
  return { path: query ? `${base}?${query}` : base, segments }
}

const SCOPE = /^(patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)$/

function grants(scope: string, type: string, interaction: Interaction) {
  const match = SCOPE.exec(scope)
  if (!match) return false
  const [, , resource, rights] = match
  if (resource !== '*' && resource !== type) return false
  const letters =
    rights === '*'
      ? 'cruds'
      : rights === 'read'
        ? 'rs'
        : rights === 'write'
          ? 'cud'
          : rights
  return letters.includes(interaction)
}

/** The scope to name when `type`/`interaction` was refused: the app's own wording if it has one. */
function missingScope(
  type: string,
  interaction: Interaction,
  granted: string[],
  asked: string[],
): { scope: string; listed: boolean } {
  const listed = asked.find((scope) => grants(scope, type, interaction))
  if (listed) return { scope: listed, listed: true }
  // Not asked for yet: suggest it at the level the app already uses for this type.
  const sameType = [...asked, ...granted]
    .map((scope) => SCOPE.exec(scope))
    .find((match) => match?.[2] === type)
  const level = sameType?.[1] ?? 'patient'
  const letters =
    interaction === 'r' || interaction === 's' ? 'rs' : interaction
  return { scope: `${level}/${type}.${letters}`, listed: false }
}

function hint(
  status: number,
  outcome: OperationOutcome | undefined,
  type: string | undefined,
  interaction: Interaction | undefined,
  paramNames: string[],
): string | undefined {
  const refusesInteraction = outcome?.issue.some(
    (issue) => issue.code === 'not-supported',
  )
  if (status === 400 && refusesInteraction) {
    return `The EHR does not support this interaction${type ? ` for ${type}` : ''}.`
  }
  if (status === 400 && interaction === 's' && paramNames.length > 0) {
    return (
      `The EHR refused a search parameter or its value. Parameters sent: ` +
      `${paramNames.join(', ')}. Its CapabilityStatement lists the ones it accepts` +
      `${type ? ` for ${type}` : ''}: fhir.request('GET', 'metadata').`
    )
  }
  if (status === 404 && type && interaction && interaction !== 'r') {
    return interaction === 's' || interaction === 'c'
      ? `The EHR does not serve ${type}.`
      : `The EHR does not serve ${type}, or this one does not exist.`
  }
  if (status === 412) {
    return 'It changed in the EHR since it was read: read it again and retry.'
  }
  if (status === 428) {
    return 'The EHR needs the version this change is based on: read the resource first and pass on its meta.versionId.'
  }
  return undefined
}

export interface FhirClientOptions {
  /** The scopes the app asks for (smart.json), used to name a refused one in its own words. */
  asked?: string[]
}

/**
 * Builds the FHIR helper for one request. `cookie` returns the Cookie header of the
 * request being answered; it is passed on as is and never read.
 */
export function createFhirClient(
  cookie: () => string | undefined,
  { asked = [] }: FhirClientOptions = {},
) {
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

  /** One call to the clinic's FHIR API. `what` goes into error messages: no ids, no values. */
  async function fhir<T>(
    what: string,
    path: string,
    about: { type?: string; interaction?: Interaction; params?: string[] },
    init: { method?: Method; body?: unknown; version?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (init.body !== undefined) {
      headers['content-type'] =
        init.method === 'PATCH' && Array.isArray(init.body)
          ? 'application/json-patch+json'
          : 'application/fhir+json'
    }
    if (init.version !== undefined) {
      if (!/^[A-Za-z0-9\-.]{1,64}$/.test(init.version)) {
        throw new TypeError('Not a valid version id.')
      }
      headers['if-match'] = `W/"${init.version}"`
    }
    const response = await send(what, path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const body = (await response.json().catch(() => undefined)) as unknown
    if (response.ok) return body as T

    const { type, interaction, params = [] } = about
    const outcome =
      (body as OperationOutcome | undefined)?.resourceType ===
      'OperationOutcome'
        ? (body as OperationOutcome)
        : undefined
    if (response.status === 403 && type && interaction) {
      const { scopes } = await context()
      if (!scopes.some((scope) => grants(scope, type, interaction))) {
        const missing = missingScope(type, interaction, scopes, asked)
        throw new ScopeRefusedError(missing.scope, missing.listed)
      }
    }
    throw new FhirRequestError(
      response.status,
      what,
      outcome,
      hint(response.status, outcome, type, interaction, params),
    )
  }

  /** Reads one resource by its id. */
  function read<T extends ResourceType>(
    type: T,
    id: string,
  ): Promise<ResourceOf<T>> {
    return fhir(`Reading ${checkType(type)}`, `/fhir/${type}/${checkId(id)}`, {
      type,
      interaction: 'r',
    })
  }

  /**
   * Searches resources of one type and also returns what the EHR sent along with them
   * (`_include`, `_revinclude`). Follows the EHR's pages until `max` matches are collected.
   */
  async function searchWithIncluded<T extends ResourceType>(
    type: T,
    params: SearchParams = {},
    { max = 200 }: SearchOptions = {},
  ): Promise<{ matches: ResourceOf<T>[]; included: FhirResource[] }> {
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(params)) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one !== undefined) query.append(name, one)
      }
    }
    const names = [...new Set(query.keys())]
    let path: string | undefined =
      `/fhir/${checkType(type)}${query.size ? `?${query}` : ''}`
    const matches: ResourceOf<T>[] = []
    const included = new Map<string, FhirResource>()

    while (path && matches.length < max) {
      const bundle: Bundle = await fhir(`Searching ${type}`, path, {
        type,
        interaction: 's',
        params: names,
      })
      for (const { resource, search } of bundle.entry ?? []) {
        if (!resource || search?.mode === 'outcome') continue
        const isMatch = search?.mode
          ? search.mode === 'match'
          : resource.resourceType === type
        if (isMatch && resource.resourceType === type) {
          matches.push(resource as ResourceOf<T>)
        } else {
          const other = resource as FhirResource
          included.set(`${other.resourceType}/${other.id}`, other)
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
    return { matches: matches.slice(0, max), included: [...included.values()] }
  }

  /**
   * Searches resources of one type and returns the matches. With a patient launch the EHR
   * only returns what belongs to the launched patient.
   */
  async function search<T extends ResourceType>(
    type: T,
    params?: SearchParams,
    options?: SearchOptions,
  ): Promise<ResourceOf<T>[]> {
    return (await searchWithIncluded(type, params, options)).matches
  }

  /** Creates a resource in the EHR and returns it as stored. */
  function create<R extends FhirResource>(resource: R): Promise<R> {
    const type = checkType(resource.resourceType)
    return fhir(
      `Creating ${type}`,
      `/fhir/${type}`,
      { type, interaction: 'c' },
      { method: 'POST', body: resource },
    )
  }

  /**
   * Replaces a resource in the EHR with the one given and returns it as stored. Read it,
   * change the copy, pass the whole copy: its `id` says which one, its `meta.versionId` lets
   * the EHR refuse the change when someone else changed it in between.
   */
  function update<R extends FhirResource>(resource: R): Promise<R> {
    const type = checkType(resource.resourceType)
    return fhir(
      `Updating ${type}`,
      `/fhir/${type}/${checkId(resource.id)}`,
      { type, interaction: 'u' },
      { method: 'PUT', body: resource, version: resource.meta?.versionId },
    )
  }

  /** Deletes a resource. Pass the resource as it was read, or its type and id. */
  async function remove(resource: FhirResource): Promise<void>
  async function remove(
    type: ResourceType,
    id: string,
    options?: RequestOptions,
  ): Promise<void>
  async function remove(
    first: FhirResource | ResourceType,
    id?: string,
    options: RequestOptions = {},
  ): Promise<void> {
    const [type, key, version] =
      typeof first === 'string'
        ? [first, id, options.version]
        : [first.resourceType, first.id, first.meta?.versionId]
    await fhir(
      `Deleting ${checkType(type)}`,
      `/fhir/${type}/${checkId(key)}`,
      { type, interaction: 'd' },
      { method: 'DELETE', version },
    )
  }

  /**
   * Any other call to the clinic's FHIR API: an operation ("Patient/123/$everything"), a
   * patch, a version read, the CapabilityStatement ("metadata"). `path` is relative to the
   * FHIR base and can carry a query; it cannot name another address. Returns the answer's
   * JSON, or undefined when the EHR sends none.
   */
  function request<T = unknown>(
    method: Method,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const target = fhirPath(path)
    // Named for a refused scope only when the path plainly is "<Type>" or "<Type>/<id>".
    const [first, second, ...more] = target.segments
    const isId = second !== undefined && /^[A-Za-z0-9\-.]{1,64}$/.test(second)
    const plain =
      first !== undefined &&
      /^[A-Z][A-Za-z]*$/.test(first) &&
      more.length === 0 &&
      (second === undefined || isId)
    const interaction: Interaction | undefined = !plain
      ? undefined
      : method === 'GET'
        ? isId
          ? 'r'
          : 's'
        : method === 'POST'
          ? isId
            ? undefined
            : 'c'
          : !isId
            ? undefined
            : method === 'DELETE'
              ? 'd'
              : 'u'
    const type = interaction ? first : undefined
    return fhir(
      `A ${method} request`,
      target.path,
      { type, interaction },
      { method, body, version: options.version },
    )
  }

  return {
    context,
    read,
    search,
    searchWithIncluded,
    create,
    update,
    delete: remove,
    request,
  }
}

export type FhirClient = ReturnType<typeof createFhirClient>
