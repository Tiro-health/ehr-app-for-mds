/**
 * An in-memory EHR for tests: a FHIR server that only answers to a live access token, scoped to
 * the launched patient, with SMART App State on the server itself or on an associated endpoint.
 *
 * The sign-in itself (launch, client assertion, PKCE, refresh) happens in Tiro's auth proxy, not
 * in this app, and is tested there. `launchedClient` plays the proxy: a clinician who opened the
 * app from a patient's chart, and the proxy's token endpoint, which hands out a fresh access
 * token when asked and says the sign-in ended once the EHR revoked the grant.
 */
import type { EhrConnection } from './connection'

export const ORIGIN = 'https://ehr.example.org'
export const ISS = `${ORIGIN}/t/clinic/fhir/R4`
export const APP_STATE = `${ORIGIN}/appstate`
export const PRACTITIONER = 'Practitioner/123'

type Resource = { resourceType: string; id?: string; [key: string]: unknown }
type Grant = {
  patient: string
  scope: string
  revoked: boolean
}

/** What a test launch asks for. Fixed, not app.config.ts's, so tests keep their meaning. */
export type TestSettings = { scopes: string[] }

export function testSettings(): TestSettings {
  return {
    scopes: ['patient/Patient.rs', 'patient/Encounter.rs', 'offline_access'],
  }
}

export function fakeEhr(
  options: {
    /** The clinician's identity (fhirUser) comes with the sign-in. */
    openid?: boolean
    /** Adds SMART App State, on the FHIR server or on an associated endpoint. */
    appState?: boolean | 'associated'
    /** Seconds an access token lives. */
    tokenLifetime?: number
  } = {},
) {
  const resources = new Map<string, Resource>()
  const grants: Grant[] = []
  const accessTokens = new Map<string, { grant: Grant; expiresAt: number }>()
  /** Every time the auth proxy was asked for a token after the launch. */
  const refreshes: number[] = []
  let nextId = 1000
  const appStateBase = options.appState === 'associated' ? APP_STATE : ISS

  const json = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/fhir+json', ...headers },
    })

  function issue(grant: Grant) {
    const accessToken = `access-${crypto.randomUUID()}`
    accessTokens.set(accessToken, {
      grant,
      expiresAt: Date.now() / 1000 + (options.tokenLifetime ?? 300),
    })
    return accessToken
  }

  function liveGrant(headers: Headers) {
    const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
    const entry = accessTokens.get(bearer)
    if (!entry || entry.grant.revoked || entry.expiresAt <= Date.now() / 1000)
      return null
    return entry.grant
  }

  function fhir(url: URL, method: string, headers: Headers, body: string) {
    const grant = liveGrant(headers)
    if (!grant) return json(401, outcome('Not authorised'))
    const base = url.href.startsWith(appStateBase) ? appStateBase : ISS
    const [type, id] = url.href
      .slice(base.length + 1)
      .split('?')[0]
      .split('/')
    if (type === 'Basic') return basic(url, method, headers, body, id)
    if (method !== 'GET') return json(405, outcome('Not allowed'))
    if (id) {
      const found = resources.get(`${type}/${id}`)
      // Another patient's record is invisible, not forbidden: it cannot be probed.
      if (!found || !inCompartment(found, grant.patient))
        return json(404, outcome('Not found'))
      return json(200, found)
    }
    const entry = [...resources.values()]
      .filter((r) => r.resourceType === type && inCompartment(r, grant.patient))
      .filter((r) => matches(r, url.searchParams))
      .map((resource) => ({ resource }))
    return json(200, {
      resourceType: 'Bundle',
      type: 'searchset',
      total: entry.length,
      entry,
    })
  }

  function basic(
    url: URL,
    method: string,
    headers: Headers,
    body: string,
    id: string | undefined,
  ) {
    const base = appStateBase
    if (method === 'GET' && !id) {
      const [system, code] = (url.searchParams.get('code') ?? '').split('|')
      const subject = url.searchParams.get('subject')
      const entry = [...resources.values()]
        .filter(
          (r) =>
            r.resourceType === 'Basic' &&
            codingOf(r)?.system === system &&
            codingOf(r)?.code === code &&
            absoluteSubject(r, base) === subject,
        )
        .map((resource) => ({ resource }))
      return json(200, { resourceType: 'Bundle', type: 'searchset', entry })
    }
    if (method === 'GET' && id) {
      const r = resources.get(`Basic/${id}`)
      return r ? json(200, r) : json(404, outcome('Not found'))
    }
    if (method === 'POST') {
      const r = JSON.parse(body) as Resource
      if (r.id || r.meta) return json(400, outcome('No id on create'))
      const duplicate = [...resources.values()].some(
        (other) =>
          other.resourceType === 'Basic' &&
          JSON.stringify(other.code) === JSON.stringify(r.code) &&
          absoluteSubject(other, base) === absoluteSubject(r, base),
      )
      if (duplicate) return json(409, outcome('State exists for this code'))
      // Like HAPI, references to this server's own resources are stored relative.
      const saved = {
        ...relativeSubject(r, base),
        id: String(nextId++),
        meta: { versionId: '1' },
      }
      resources.set(`Basic/${saved.id}`, saved)
      return json(201, saved, {
        Location: `${appStateBase}/Basic/${saved.id}/_history/1`,
        ETag: 'W/"1"',
      })
    }
    if (method === 'PUT' && id) {
      const existing = resources.get(`Basic/${id}`)
      const r = JSON.parse(body) as Resource
      const version = (existing?.meta as { versionId: string } | undefined)
        ?.versionId
      if (!headers.get('If-Match'))
        return json(428, outcome('If-Match is required'))
      if (
        !existing ||
        headers.get('If-Match') !== `W/"${version}"` ||
        r.id !== id ||
        absoluteSubject(r, base) !== absoluteSubject(existing, base) ||
        JSON.stringify(r.code) !== JSON.stringify(existing.code)
      ) {
        return json(412, outcome('Version conflict'))
      }
      const next = String(Number(version) + 1)
      const saved = { ...relativeSubject(r, base), meta: { versionId: next } }
      resources.set(`Basic/${id}`, saved)
      return json(200, saved, { ETag: `W/"${next}"` })
    }
    return json(405, outcome('Not allowed'))
  }

  const fetchImpl = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body = init.body ? String(init.body) : ''
    if (url.href.startsWith(ISS) || url.href.startsWith(appStateBase))
      return fhir(url, method, headers, body)
    return json(404, outcome('Unknown address'))
  }

  /**
   * A clinician opened the app from `patient`'s chart, and the auth proxy finished the sign-in.
   * Like the Tiro EHR, identity and App State are granted only when it offers them.
   */
  function signIn(patient: string, settings: TestSettings) {
    const identity = options.openid ? ['openid', 'fhirUser'] : []
    const appState =
      options.openid && options.appState ? ['user/Basic.cruds'] : []
    const grant: Grant = {
      patient,
      scope: [...settings.scopes, ...identity, ...appState].join(' '),
      revoked: false,
    }
    grants.push(grant)
    const connection = (): EhrConnection => ({
      status: 'launched',
      fhirBase: ISS,
      accessToken: issue(grant),
      expiresAt: Math.floor(Date.now() / 1000) + (options.tokenLifetime ?? 300),
      scope: grant.scope,
      patient,
      ...(options.openid ? { fhirUser: `${ISS}/${PRACTITIONER}` } : {}),
      ...(appState.length ? { appStateEndpoint: appStateBase } : {}),
    })
    /** The auth proxy's token endpoint, as the browser asks it. */
    const connect = async (): Promise<EhrConnection> => {
      refreshes.push(Date.now())
      return grant.revoked ? { status: 'ended' } : connection()
    }
    return { first: connection(), connect }
  }

  return {
    fetch: fetchImpl as typeof fetch,
    resources,
    refreshes,
    signIn,
    /** Adds resources to the EHR's records. */
    add(...list: Resource[]) {
      for (const r of list) resources.set(`${r.resourceType}/${r.id}`, r)
    },
    /** Makes every access token handed out so far expire now. */
    expireAccessTokens() {
      for (const entry of accessTokens.values()) entry.expiresAt = 0
    },
    grants() {
      return grants
    },
  }
}

function inCompartment(r: Resource, patient: string) {
  if (r.resourceType === 'Patient') return r.id === patient
  return subjectOf(r) === `Patient/${patient}`
}

function matches(r: Resource, params: URLSearchParams) {
  for (const [name, value] of params) {
    if (name.startsWith('_')) continue
    if (name === 'patient' || name === 'subject') {
      if (subjectOf(r) !== `Patient/${value.replace(/^Patient\//, '')}`)
        return false
    } else if (name === 'status') {
      if (r.status !== value) return false
    } else {
      // The Tiro facade refuses search parameters it does not know.
      return false
    }
  }
  return true
}

function absoluteSubject(r: Resource, base: string) {
  const ref = subjectOf(r)
  return ref ? new URL(ref, `${base}/`).href : undefined
}

function relativeSubject(r: Resource, base: string): Resource {
  const ref = subjectOf(r)
  return ref?.startsWith(`${base}/`)
    ? { ...r, subject: { reference: ref.slice(base.length + 1) } }
    : r
}

function subjectOf(r: Resource) {
  return (r.subject as { reference?: string } | undefined)?.reference
}

function codingOf(r: Resource) {
  return (r.code as { coding?: { system: string; code: string }[] } | undefined)
    ?.coding?.[0]
}

function outcome(text: string) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'processing', diagnostics: text }],
  }
}

/**
 * A launch from `patient`'s chart, and the browser's client for it: what a test needs to
 * exercise code that reads and writes through the EHR.
 */
export async function launchedClient(
  ehr: ReturnType<typeof fakeEhr>,
  settings: TestSettings,
  patient: string,
) {
  const { EhrClient } = await import('./client')
  const { first, connect } = ehr.signIn(patient, settings)
  if (first.status !== 'launched') throw new Error('not launched')
  return new EhrClient(first, connect, () => {}, ehr.fetch)
}
