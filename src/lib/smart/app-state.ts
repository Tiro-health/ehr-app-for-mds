/**
 * A small client for SMART App State: app data stored as FHIR Basic resources on the EHR.
 * https://hl7.org/fhir/smart-app-launch/app-state.html
 *
 * Every piece of state is one Basic resource, found by its state code (`Basic.code`) and its
 * subject (`Basic.subject`, here the signed-in practitioner). The value itself is JSON in a
 * single valueString extension.
 */

export type AppStateTarget = {
  /** Base URL of the App State FHIR endpoint (may differ from the main FHIR server). */
  endpoint: string
  accessToken: string
  /** Code system for the state codes. The app's own origin, as the spec recommends. */
  system: string
  /** Absolute reference to the subject, e.g. https://ehr.example.org/fhir/Practitioner/123 */
  subject: string
}

export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json }

export type StoredState = {
  id: string
  version: string
  value: Json | undefined
}

export type SaveResult =
  | { status: 'saved'; state: StoredState }
  | { status: 'conflict'; state: StoredState | null }

type Basic = {
  resourceType: 'Basic'
  id?: string
  meta?: { versionId?: string }
  subject?: { reference: string }
  code: { coding: { system: string; code: string }[] }
  extension?: { url: string; valueString?: string }[]
}

type Fetch = typeof fetch

const MAX_BYTES = 256 * 1024

export function valueExtensionUrl(system: string) {
  return `${system.replace(/\/$/, '')}/app-state-value`
}

export async function readState(
  target: AppStateTarget,
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<StoredState | null> {
  const url = new URL(`${base(target)}/Basic`)
  url.searchParams.set('code', `${target.system}|${code}`)
  url.searchParams.set('subject', target.subject)
  const res = await fetchImpl(url, { headers: headers(target) })
  await expectOk(res, 'read app state')
  const bundle = (await res.json()) as { entry?: { resource?: Basic }[] }
  const match = (bundle.entry ?? [])
    .map((e) => e.resource)
    .find(
      (r): r is Basic =>
        r?.resourceType === 'Basic' &&
        r.subject?.reference === target.subject &&
        r.code?.coding?.some(
          (c) => c.system === target.system && c.code === code,
        ),
    )
  return match ? toStored(match, target.system, res) : null
}

/**
 * Creates the state when `expectedVersion` is null, otherwise updates it with If-Match.
 * A version mismatch (412) comes back as a conflict carrying the latest stored state.
 */
export async function writeState(
  target: AppStateTarget,
  code: string,
  value: Json,
  current: { id: string; version: string } | null,
  fetchImpl: Fetch = fetch,
): Promise<SaveResult> {
  const resource: Basic = {
    resourceType: 'Basic',
    ...(current ? { id: current.id } : {}),
    subject: { reference: target.subject },
    code: { coding: [{ system: target.system, code }] },
    extension: [
      {
        url: valueExtensionUrl(target.system),
        valueString: JSON.stringify(value),
      },
    ],
  }
  const body = JSON.stringify(resource)
  if (new TextEncoder().encode(body).length > MAX_BYTES) {
    throw new Error('App state is larger than the 256 KB the EHR accepts.')
  }

  const res = current
    ? await fetchImpl(
        `${base(target)}/Basic/${encodeURIComponent(current.id)}`,
        {
          method: 'PUT',
          headers: {
            ...headers(target),
            'Content-Type': 'application/fhir+json',
            'If-Match': etag(current.version),
          },
          body,
        },
      )
    : await fetchImpl(`${base(target)}/Basic`, {
        method: 'POST',
        headers: {
          ...headers(target),
          'Content-Type': 'application/fhir+json',
          Prefer: 'return=representation',
        },
        body,
      })

  if (res.status === 412 || res.status === 409) {
    return {
      status: 'conflict',
      state: await readState(target, code, fetchImpl),
    }
  }
  await expectOk(res, 'save app state')
  const saved = await savedResource(res, resource, target, fetchImpl)
  return { status: 'saved', state: toStored(saved, target.system, res) }
}

function base(target: AppStateTarget) {
  return target.endpoint.replace(/\/$/, '')
}

function headers(target: AppStateTarget) {
  return {
    Authorization: `Bearer ${target.accessToken}`,
    Accept: 'application/fhir+json',
  }
}

function etag(version: string) {
  return `W/"${version}"`
}

/** Some servers answer with an empty body; fall back to reading the resource they point at. */
async function savedResource(
  res: Response,
  sent: Basic,
  target: AppStateTarget,
  fetchImpl: Fetch,
): Promise<Basic> {
  const text = await res.text()
  if (text) return JSON.parse(text) as Basic
  const location =
    res.headers.get('Location') ?? res.headers.get('Content-Location')
  const id = location?.match(/Basic\/([^/]+)/)?.[1] ?? sent.id
  if (!id) throw new Error('The EHR did not say where it saved the app state.')
  const read = await fetchImpl(`${base(target)}/Basic/${id}`, {
    headers: headers(target),
  })
  await expectOk(read, 'read saved app state')
  return (await read.json()) as Basic
}

function toStored(
  resource: Basic,
  system: string,
  res?: Response,
): StoredState {
  const version =
    resource.meta?.versionId ??
    res?.headers.get('ETag')?.match(/"([^"]+)"/)?.[1] ??
    ''
  if (!resource.id || !version) {
    throw new Error('The EHR returned app state without an id or version.')
  }
  const raw = resource.extension?.find(
    (e) => e.url === valueExtensionUrl(system),
  )?.valueString
  return { id: resource.id, version, value: parseValue(raw) }
}

/** The spec asks apps to treat stored values as untrusted: never throw on bad content. */
function parseValue(raw: string | undefined): Json | undefined {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as Json
  } catch {
    return undefined
  }
}

async function expectOk(res: Response, what: string) {
  if (!res.ok) {
    throw new Error(`Could not ${what}: the EHR answered ${res.status}.`)
  }
}
