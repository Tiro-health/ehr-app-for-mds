/**
 * An in-memory EHR for tests: a FHIR server that only answers to a live access token, scoped to
 * the launched patient, with SMART App State on the server itself or on an associated endpoint.
 *
 * The sign-in itself (launch, client assertion, PKCE, refresh) happens in Tiro's auth proxy, not
 * in this app, and is tested there. `launchedClient` plays the proxy: a clinician who opened the
 * app from a patient's chart, and the proxy's token endpoint, which hands out a fresh access
 * token when asked and says the sign-in ended once the EHR revoked the grant.
 */
import type { FhirResource } from 'fhir/r4'
import type { EhrConnection } from './connection'

type Launched = Extract<EhrConnection, { status: 'launched' }>

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
  const fhirRequests: string[] = []
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
    fhirRequests.push(url.href)
    const grant = liveGrant(headers)
    if (!grant) return json(401, outcome('Not authorised'))
    const base = url.href.startsWith(appStateBase) ? appStateBase : ISS
    const [type, id] = url.href
      .slice(base.length + 1)
      .split('?')[0]
      .split('/')
    if (type === 'Basic') return basic(url, method, headers, body, id)
    const letter = method === 'POST' ? 'c' : id ? 'r' : 's'
    if (!granted(grant.scope, type, letter))
      return json(403, outcome('The request could not be completed.'))
    if (method === 'POST' && type === 'DocumentReference' && !id)
      return createDocument(body, grant)
    if (method !== 'GET') return json(405, outcome('Not allowed'))
    if (id) {
      const found = resources.get(`${type}/${id}`)
      // Another patient's record is invisible, not forbidden: it cannot be probed.
      if (!found || !inCompartment(found, grant.patient))
        return json(404, outcome('Not found'))
      return json(200, found)
    }
    const allowed = SEARCH_PARAMETERS[type] ?? []
    for (const name of url.searchParams.keys()) {
      if (!['_count', '_offset'].includes(name) && !allowed.includes(name))
        return json(400, outcome('unsupported search parameter'))
    }
    const all = [...resources.values()]
      .filter((r) => r.resourceType === type && inCompartment(r, grant.patient))
      .filter((r) => matches(r, url.searchParams))
    const count = Number(url.searchParams.get('_count') ?? 50)
    const offset = Number(url.searchParams.get('_offset') ?? 0)
    const page = all.slice(offset, offset + count)
    const nextUrl = new URL(url)
    nextUrl.searchParams.set('_offset', String(offset + count))
    return json(200, {
      resourceType: 'Bundle',
      type: 'searchset',
      total: all.length,
      link: [
        { relation: 'self', url: url.href },
        ...(offset + count < all.length
          ? [{ relation: 'next', url: nextUrl.href }]
          : []),
      ],
      entry: page.map((resource) => ({
        fullUrl: `${ISS}/${type}/${resource.id}`,
        resource,
      })),
    })
  }

  /** The Tiro facade's DocumentReference create rules (S11/S12): refused elements are 422. */
  function createDocument(body: string, grant: Grant) {
    const doc = JSON.parse(body) as Resource & {
      status?: string
      type?: { coding?: { system?: string; code?: string }[] }
      content?: { attachment?: { contentType?: string; data?: string } }[]
    }
    const problems = [
      doc.status !== 'current' && 'status must be current',
      'date' in doc && 'date is not stored',
      'context' in doc && 'context is not stored',
      subjectOf(doc) !== `Patient/${grant.patient}` &&
        'subject names no patient this grant can reach',
      !doc.type?.coding?.some((c) => c.system === 'urn:tv:document-kind') &&
        'type needs a urn:tv:document-kind coding',
      ['encounter_note', 'quote'].includes(doc.type?.coding?.[0]?.code ?? '') &&
        'type names a document kind this clinic does not file',
      doc.content?.length !== 1 && 'content must carry exactly one attachment',
      !doc.content?.[0]?.attachment?.contentType && 'contentType is required',
      !doc.content?.[0]?.attachment?.data && 'data is required',
    ].filter(Boolean)
    if (problems.length) return json(422, outcome(problems.join('; ')))
    const saved = { ...doc, id: String(nextId++), meta: { versionId: '1' } }
    resources.set(`DocumentReference/${saved.id}`, saved)
    return json(201, saved, {
      Location: `${ISS}/DocumentReference/${saved.id}/_history/1`,
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
    const connection = (): Launched => ({
      status: 'launched',
      fhirBase: ISS,
      accessToken: issue(grant),
      expiresAt: Math.floor(Date.now() / 1000) + (options.tokenLifetime ?? 300),
      scope: grant.scope,
      patient,
      ...(options.openid ? { fhirUser: `${ISS}/${PRACTITIONER}` } : {}),
      ...(appState.length ? { appStateEndpoint: appStateBase } : {}),
    })
    let current = connection()
    /**
     * The auth proxy's token endpoint, as the browser asks it: the same token until it is about
     * to expire or the EHR refused it, then a fresh one, unless the EHR revoked the grant.
     */
    const connect = async (rejected?: string): Promise<EhrConnection> => {
      const live = accessTokens.get(current.accessToken)
      const expiring = !live || live.expiresAt - 60 <= Date.now() / 1000
      if (rejected !== current.accessToken && !expiring) return current
      refreshes.push(Date.now())
      if (grant.revoked) return { status: 'ended' }
      current = connection()
      return current
    }
    return { first: current, connect }
  }

  return {
    fetch: fetchImpl as typeof fetch,
    resources,
    refreshes,
    /** Every FHIR request, in order. */
    fhirRequests,
    signIn,
    /** Adds resources to the EHR's records. */
    add(...list: (Resource | FhirResource)[]) {
      for (const r of list)
        resources.set(`${r.resourceType}/${r.id}`, r as Resource)
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

/** What the Tiro facade serves; anything else is a 400. */
const SEARCH_PARAMETERS: Record<string, string[]> = {
  Patient: ['gender', 'family', 'given', 'identifier'],
  Encounter: ['status', 'class'],
  DocumentReference: ['patient', 'subject', 'identifier'],
}

/** Exact matches only, like the facade. */
function matches(r: Resource, params: URLSearchParams) {
  for (const [name, value] of params) {
    if (name.startsWith('_')) continue
    if (name === 'patient' || name === 'subject') {
      if (subjectOf(r) !== `Patient/${value.replace(/^Patient\//, '')}`)
        return false
    } else if (name === 'class') {
      if ((r.class as { code?: string } | undefined)?.code !== value)
        return false
    } else if (r[name] !== value) return false
  }
  return true
}

function granted(scope: string, type: string, letter: string) {
  return scope.split(' ').some((s) => {
    const m = /^patient\/([A-Za-z]+)\.([cruds]+)$/.exec(s)
    return m?.[1] === type && m[2].includes(letter)
  })
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
 * A launch from `patient`'s chart. `connect` plays Tiro's auth proxy, which hands out the access
 * token and refreshes it. `client` is the browser's client for that connection.
 */
export async function launchInFakeEhr(
  ehr: ReturnType<typeof fakeEhr>,
  settings: TestSettings,
  patient: string,
) {
  const { EhrClient } = await import('./client')
  const { first, connect } = ehr.signIn(patient, settings)
  const client = new EhrClient(first, connect, () => {}, ehr.fetch)
  return { client, connect }
}

/** The browser's client after a launch into the fake EHR. */
export async function launchedClient(
  ehr: ReturnType<typeof fakeEhr>,
  settings: TestSettings,
  patient: string,
) {
  return (await launchInFakeEhr(ehr, settings, patient)).client
}
