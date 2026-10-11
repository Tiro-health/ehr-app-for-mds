/**
 * An in-memory EHR for tests that follows the Tiro EHR's SMART contract: discovery on the tenant
 * base, `private_key_jwt` (ES384, single-use `jti`, `aud` = the token endpoint), PKCE S256,
 * 300-second access tokens, refresh tokens that rotate and revoke the grant when reused, and a
 * FHIR server that only answers to a live token. `sso-openid-connect` and `smart-app-state`
 * can be switched on to test what the EHR will offer next.
 */
import type { FhirResource } from 'fhir/r4'
import { fromBase64Url, publicJwk, type PrivateJwk } from './keys'
import type { EhrConnection } from './connection.functions'
import type { SmartSettings } from './launch'

export const ORIGIN = 'https://ehr.example.org'
export const ISS = `${ORIGIN}/t/clinic/fhir/R4`
export const TOKEN_ENDPOINT = `${ORIGIN}/oauth/token`
export const AUTHORIZE_ENDPOINT = `${ORIGIN}/oauth/authorize`
export const APP_STATE = `${ORIGIN}/appstate`
export const APP_URL = 'https://app.example.org'
export const CLIENT_ID = 'test-app'
export const PRACTITIONER = 'Practitioner/123'

type Resource = { resourceType: string; id?: string; [key: string]: unknown }
type Grant = {
  patient: string
  scope: string
  refreshToken: string | null
  usedRefreshTokens: Set<string>
  revoked: boolean
}

export async function testKey(): Promise<PrivateJwk> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { ...jwk, kid: 'test-key', alg: 'ES384' }
}

/**
 * Settings for a test launch. The scopes are fixed, not app.config.ts's, so tests keep their
 * meaning when the app asks for more; a test that needs more passes `{ ...settings, scopes }`.
 */
export async function testSettings(): Promise<SmartSettings> {
  return {
    clientId: CLIENT_ID,
    privateJwk: await testKey(),
    allowedIssuers: [ISS],
    appUrl: APP_URL,
    scopes: ['patient/Patient.rs', 'patient/Encounter.rs', 'offline_access'],
  }
}

export function fakeEhr(
  settings: SmartSettings,
  options: {
    /** Adds `sso-openid-connect` and an id_token with fhirUser. */
    openid?: boolean
    /** Adds `smart-app-state`, on the FHIR server or on an associated endpoint. */
    appState?: boolean | 'associated'
    /** Seconds an access token lives. */
    tokenLifetime?: number
  } = {},
) {
  const resources = new Map<string, Resource>()
  const grants = new Map<string, Grant>()
  const accessTokens = new Map<string, { grant: Grant; expiresAt: number }>()
  const codes = new Map<
    string,
    { challenge: string; redirectUri: string; scope: string; patient: string }
  >()
  const seenJti = new Set<string>()
  const tokenRequests: URLSearchParams[] = []
  const fhirRequests: string[] = []
  let nextId = 1000
  const appStateBase = options.appState === 'associated' ? APP_STATE : ISS
  const clientKey = publicJwk(settings.privateJwk)

  const json = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/fhir+json', ...headers },
    })
  const oauthError = (status: number, error: string) =>
    json(status, { error, error_description: error })

  function capabilities() {
    return [
      'launch-ehr',
      'launch-standalone',
      'context-ehr-patient',
      'permission-offline',
      'permission-patient',
      'client-confidential-asymmetric',
      ...(options.openid ? ['sso-openid-connect'] : []),
      ...(options.appState === true ? ['smart-app-state'] : []),
    ]
  }

  async function verifyAssertion(form: URLSearchParams) {
    const assertion = form.get('client_assertion') ?? ''
    if (
      form.get('client_assertion_type') !==
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    )
      return false
    const [h, p, s] = assertion.split('.')
    if (!h || !p || !s) return false
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(h)))
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(p)))
    if (header.alg !== 'ES384' || header.kid !== clientKey.kid) return false
    const key = await crypto.subtle.importKey(
      'jwk',
      {
        kty: clientKey.kty,
        crv: clientKey.crv,
        x: clientKey.x,
        y: clientKey.y,
      },
      { name: 'ECDSA', namedCurve: 'P-384' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-384' },
      key,
      fromBase64Url(s),
      new TextEncoder().encode(`${h}.${p}`),
    )
    const now = Date.now() / 1000
    if (
      !valid ||
      claims.iss !== CLIENT_ID ||
      claims.sub !== CLIENT_ID ||
      claims.aud !== TOKEN_ENDPOINT ||
      !(claims.exp > now && claims.exp <= now + 300) ||
      typeof claims.jti !== 'string' ||
      seenJti.has(claims.jti)
    )
      return false
    seenJti.add(claims.jti)
    return true
  }

  function issue(grant: Grant) {
    const accessToken = `access-${crypto.randomUUID()}`
    accessTokens.set(accessToken, {
      grant,
      expiresAt: Date.now() / 1000 + (options.tokenLifetime ?? 300),
    })
    return accessToken
  }

  async function token(form: URLSearchParams) {
    tokenRequests.push(form)
    if (!(await verifyAssertion(form))) return oauthError(401, 'invalid_client')

    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      if (!code || code.redirectUri !== form.get('redirect_uri'))
        return oauthError(400, 'invalid_grant')
      const challenge = await s256(form.get('code_verifier') ?? '')
      if (challenge !== code.challenge) return oauthError(400, 'invalid_grant')
      const offline = code.scope.split(' ').includes('offline_access')
      const grant: Grant = {
        patient: code.patient,
        scope: code.scope,
        refreshToken: offline ? `refresh-${crypto.randomUUID()}` : null,
        usedRefreshTokens: new Set(),
        revoked: false,
      }
      grants.set(crypto.randomUUID(), grant)
      const openid = code.scope.split(' ').includes('openid')
      return json(200, {
        token_type: 'Bearer',
        access_token: issue(grant),
        expires_in: options.tokenLifetime ?? 300,
        scope: grant.scope,
        patient: grant.patient,
        ...(grant.refreshToken ? { refresh_token: grant.refreshToken } : {}),
        ...(openid
          ? { id_token: unsignedJwt({ fhirUser: PRACTITIONER, sub: 'u1' }) }
          : {}),
      })
    }

    if (form.get('grant_type') === 'refresh_token') {
      const presented = form.get('refresh_token') ?? ''
      const grant = [...grants.values()].find(
        (g) =>
          g.refreshToken === presented || g.usedRefreshTokens.has(presented),
      )
      if (!grant || grant.revoked) return oauthError(400, 'invalid_grant')
      if (grant.usedRefreshTokens.has(presented)) {
        // Reuse of a rotated token: the whole grant dies, as in the Tiro EHR (D39).
        grant.revoked = true
        grant.refreshToken = null
        return oauthError(400, 'invalid_grant')
      }
      grant.usedRefreshTokens.add(presented)
      grant.refreshToken = `refresh-${crypto.randomUUID()}`
      return json(200, {
        token_type: 'Bearer',
        access_token: issue(grant),
        expires_in: options.tokenLifetime ?? 300,
        scope: grant.scope,
        refresh_token: grant.refreshToken,
      })
    }
    return oauthError(400, 'unsupported_grant_type')
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
    if (method === 'GET' && !id) {
      const [system, code] = (url.searchParams.get('code') ?? '').split('|')
      const subject = url.searchParams.get('subject')
      const entry = [...resources.values()]
        .filter(
          (r) =>
            r.resourceType === 'Basic' &&
            codingOf(r)?.system === system &&
            codingOf(r)?.code === code &&
            subjectOf(r) === subject,
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
      const saved = { ...r, id: String(nextId++), meta: { versionId: '1' } }
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
      if (
        !existing ||
        headers.get('If-Match') !== `W/"${version}"` ||
        r.id !== id ||
        subjectOf(r) !== subjectOf(existing) ||
        JSON.stringify(r.code) !== JSON.stringify(existing.code)
      ) {
        return json(412, outcome('Version conflict'))
      }
      const next = String(Number(version) + 1)
      const saved = { ...r, meta: { versionId: next } }
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

    if (url.href === `${ISS}/.well-known/smart-configuration`) {
      return json(200, {
        issuer: ORIGIN,
        authorization_endpoint: AUTHORIZE_ENDPOINT,
        token_endpoint: TOKEN_ENDPOINT,
        token_endpoint_auth_methods_supported: ['private_key_jwt'],
        token_endpoint_auth_signing_alg_values_supported: ['RS384', 'ES384'],
        code_challenge_methods_supported: ['S256'],
        capabilities: capabilities(),
        ...(options.appState === 'associated'
          ? {
              associated_endpoints: [
                { url: APP_STATE, capabilities: ['smart-app-state'] },
              ],
            }
          : {}),
      })
    }
    if (url.href === TOKEN_ENDPOINT && method === 'POST')
      return token(new URLSearchParams(body))
    if (url.href.startsWith(ISS) || url.href.startsWith(appStateBase))
      return fhir(url, method, headers, body)
    return json(404, outcome('Unknown address'))
  }

  return {
    fetch: fetchImpl as typeof fetch,
    resources,
    tokenRequests,
    /** Every FHIR request, in order. */
    fhirRequests,
    /** Adds resources to the EHR's records. */
    add(...list: (Resource | FhirResource)[]) {
      for (const r of list)
        resources.set(`${r.resourceType}/${r.id}`, r as Resource)
    },
    /**
     * The EHR's side of the authorize redirect: checks what the app sent and, as if the
     * clinician approved, returns the parameters the EHR sends back to the callback.
     */
    async approve(authorizeUrl: string, patient: string) {
      const url = new URL(authorizeUrl)
      const p = url.searchParams
      const problems = [
        url.origin + url.pathname !== AUTHORIZE_ENDPOINT && 'endpoint',
        p.get('response_type') !== 'code' && 'response_type',
        p.get('client_id') !== CLIENT_ID && 'client_id',
        p.get('aud') !== ISS && 'aud',
        p.get('code_challenge_method') !== 'S256' && 'pkce',
        !p.get('state') && 'state',
      ].filter(Boolean)
      if (problems.length) throw new Error(`Bad authorize: ${problems}`)
      // Like the Tiro EHR: user/ scopes only when the capability is there; launch dropped.
      const scope = (p.get('scope') ?? '')
        .split(' ')
        .filter(
          (s) =>
            s.startsWith('patient/') ||
            s === 'offline_access' ||
            (options.openid && (s === 'openid' || s === 'fhirUser')) ||
            (options.appState && options.openid && s.startsWith('user/Basic')),
        )
        .join(' ')
      const code = `code-${crypto.randomUUID()}`
      codes.set(code, {
        challenge: p.get('code_challenge') ?? '',
        redirectUri: p.get('redirect_uri') ?? '',
        scope,
        patient,
      })
      return { code, state: p.get('state') ?? '' }
    },
    /** Makes every access token handed out so far expire now. */
    expireAccessTokens() {
      for (const entry of accessTokens.values()) entry.expiresAt = 0
    },
    grants() {
      return [...grants.values()]
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

function unsignedJwt(claims: Record<string, unknown>) {
  const enc = (v: unknown) =>
    btoa(JSON.stringify(v))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  return `${enc({ alg: 'none' })}.${enc(claims)}.`
}

async function s256(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  let binary = ''
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A whole EHR launch against the fake EHR. `connect` plays the app's server
 * (connection.functions.ts): it hands out the access token and refreshes it when it is about to
 * expire or the EHR refused it. `client` is the browser's client for that connection.
 */
export async function launchInFakeEhr(
  ehr: ReturnType<typeof fakeEhr>,
  settings: SmartSettings,
  patient: string,
) {
  const { startLaunch, finishLaunch, needsRefresh, refreshConnection } =
    await import('./launch')
  const { EhrClient } = await import('./client')
  const { redirectTo, pending } = await startLaunch(
    settings,
    { iss: ISS, launch: 'launch-1' },
    ehr.fetch,
  )
  let connection = await finishLaunch(
    settings,
    pending,
    await ehr.approve(redirectTo, patient),
    ehr.fetch,
  )
  const asLaunched = () =>
    ({
      status: 'launched',
      fhirBase: connection.iss,
      accessToken: connection.accessToken,
      expiresAt: connection.expiresAt,
      scope: connection.scope,
      ...(connection.patient ? { patient: connection.patient } : {}),
      ...(connection.fhirUser ? { fhirUser: connection.fhirUser } : {}),
      ...(connection.appStateEndpoint
        ? { appStateEndpoint: connection.appStateEndpoint }
        : {}),
    }) as const
  const connect = async (rejected?: string): Promise<EhrConnection> => {
    if (rejected !== connection.accessToken && !needsRefresh(connection))
      return asLaunched()
    const fresh = await refreshConnection(settings, connection, ehr.fetch)
    if (!fresh) return { status: 'ended' }
    connection = fresh
    return asLaunched()
  }
  const client = new EhrClient(asLaunched(), connect, () => {}, ehr.fetch)
  return { client, connect }
}

/** The browser's client after a launch into the fake EHR. */
export async function launchedClient(
  ehr: ReturnType<typeof fakeEhr>,
  settings: SmartSettings,
  patient: string,
) {
  return (await launchInFakeEhr(ehr, settings, patient)).client
}
