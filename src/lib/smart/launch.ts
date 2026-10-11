/**
 * SMART on FHIR launch as a confidential client: discovery, the authorization redirect, the code
 * exchange and the refresh. Runs on the server only; the private key never reaches the browser.
 * https://hl7.org/fhir/smart-app-launch/app-launch.html
 *
 * The browser gets the short-lived access token (see connection.functions.ts) and reads the
 * patient's data from the EHR itself. This server never sees patient data.
 */
import { appConfig } from '@/app.config'
import {
  clientAssertion,
  fromBase64Url,
  parsePrivateJwk,
  toBase64Url,
} from './keys'
import type { PrivateJwk } from './keys'

export type SmartSettings = {
  clientId: string
  privateJwk: PrivateJwk
  /**
   * FHIR base URLs this app may be launched from. An entry ending in `/` is a prefix: it admits
   * every base below it (`https://fhir.example.org/t/` admits `…/t/<clinic>/fhir/R4`).
   * Anything else is refused.
   */
  allowedIssuers: string[]
  /** The published key set (SMART_PUBLIC_JWKS), for key rotation; else the signing key's half. */
  publicJwks?: { keys: JsonWebKey[] }
  /** Public origin of this app, e.g. https://my-app.tirohealth.app */
  appUrl: string
  /** The data scopes to ask for; app.config.ts `ehr.scopes` unless set (tests). */
  scopes?: readonly string[]
}

export type SmartConfiguration = {
  authorization_endpoint?: string
  token_endpoint?: string
  token_endpoint_auth_methods_supported?: string[]
  capabilities?: string[]
  associated_endpoints?: { url: string; capabilities?: string[] }[]
}

export type Discovery = {
  authorizationEndpoint: string
  tokenEndpoint: string
  capabilities: string[]
  /** Where SMART App State lives, when the EHR offers it. */
  appStateEndpoint: string | null
}

/** What the server keeps between the redirect to the EHR and the callback. */
export type PendingLaunch = {
  state: string
  verifier: string
  iss: string
  tokenEndpoint: string
  appStateEndpoint: string | null
}

/** The sign-in, kept in the encrypted session cookie. */
export type Connection = {
  /** The FHIR base the app was launched from (the clinic's tenant base). */
  iss: string
  tokenEndpoint: string
  accessToken: string
  refreshToken?: string
  /** Epoch seconds. */
  expiresAt: number
  scope: string
  patient?: string
  encounter?: string
  /** Absolute reference to the signed-in clinician, when the EHR says who it is. */
  fhirUser?: string
  appStateEndpoint?: string
}

export const CALLBACK_PATH = '/smart/callback'

/** Refresh this many seconds before the access token runs out. */
const EXPIRY_MARGIN = 60

/**
 * Returns null when the deploy has no SMART settings: the app then runs without an EHR.
 * A half-finished configuration is reported once in the server log.
 */
export function readSettings(env = process.env): SmartSettings | null {
  const values = {
    SMART_CLIENT_ID: env.SMART_CLIENT_ID,
    SMART_PRIVATE_JWK: env.SMART_PRIVATE_JWK,
    SMART_ISS: env.SMART_ISS,
    APP_URL: env.APP_URL,
  }
  const missing = Object.entries(values)
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k)
  if (missing.length === Object.keys(values).length) return null
  if (missing.length) {
    warnOnce(`SMART is half configured; missing ${missing.join(', ')}.`)
    return null
  }
  const privateJwk = parsePrivateJwk(values.SMART_PRIVATE_JWK!)
  return {
    clientId: values.SMART_CLIENT_ID!.trim(),
    privateJwk,
    allowedIssuers: values
      .SMART_ISS!.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) =>
        entry.endsWith('/') ? entry.replace(/\/+$/, '/') : normalizeBase(entry),
      ),
    appUrl: normalizeBase(values.APP_URL!),
    ...(env.SMART_PUBLIC_JWKS?.trim()
      ? { publicJwks: parsePublicJwks(env.SMART_PUBLIC_JWKS, privateJwk.kid) }
      : {}),
  }
}

/**
 * Whether the app may be launched from `iss`: an exact entry, or below a prefix entry by plain
 * path segments only, so `..`, encoded characters, a query or another host can never slip in.
 */
export function isAllowedIssuer(settings: SmartSettings, iss: string) {
  const exact = settings.allowedIssuers.filter((e) => !e.endsWith('/'))
  if (exact.includes(iss)) return true
  let canonical: string
  try {
    canonical = new URL(iss).href
  } catch {
    return false
  }
  if (canonical !== iss && canonical !== `${iss}/`) return false
  return settings.allowedIssuers.some((entry) => {
    if (!entry.endsWith('/') || !iss.startsWith(entry)) return false
    const segments = iss.slice(entry.length).split('/')
    return segments.every(
      (segment) =>
        /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment) &&
        segment !== '.' &&
        segment !== '..',
    )
  })
}

/** SMART_PUBLIC_JWKS: public keys only, and it must hold the key the app signs with. */
function parsePublicJwks(text: string, signingKid: string) {
  let jwks: { keys?: unknown }
  try {
    jwks = JSON.parse(text) as { keys?: unknown }
  } catch {
    throw new Error('SMART_PUBLIC_JWKS is not valid JSON.')
  }
  if (!Array.isArray(jwks.keys)) {
    throw new Error('SMART_PUBLIC_JWKS must be a JWK Set: {"keys": [...]}.')
  }
  const keys = jwks.keys as (JsonWebKey & { kid?: string })[]
  if (keys.some((k) => 'd' in k)) {
    throw new Error('SMART_PUBLIC_JWKS must not contain private keys.')
  }
  if (!keys.some((k) => k.kid === signingKid)) {
    throw new Error(
      `SMART_PUBLIC_JWKS does not contain the signing key (kid ${signingKid}).`,
    )
  }
  return { keys: keys as JsonWebKey[] }
}

export function normalizeBase(url: string) {
  return url.trim().replace(/\/+$/, '')
}

export async function discover(
  iss: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Discovery> {
  const res = await fetchImpl(`${iss}/.well-known/smart-configuration`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`The EHR's SMART configuration answered ${res.status}.`)
  }
  const config = (await res.json()) as SmartConfiguration
  if (!config.authorization_endpoint || !config.token_endpoint) {
    throw new Error(
      "The EHR's SMART configuration has no authorization endpoints.",
    )
  }
  const methods = config.token_endpoint_auth_methods_supported
  if (methods && !methods.includes('private_key_jwt')) {
    throw new Error('The EHR does not accept private_key_jwt sign-in.')
  }
  return {
    authorizationEndpoint: config.authorization_endpoint,
    tokenEndpoint: config.token_endpoint,
    capabilities: config.capabilities ?? [],
    appStateEndpoint: findAppStateEndpoint(iss, config),
  }
}

/** The FHIR server itself, or an associated endpoint that advertises smart-app-state. */
export function findAppStateEndpoint(iss: string, config: SmartConfiguration) {
  const associated = config.associated_endpoints?.find((e) =>
    e.capabilities?.includes('smart-app-state'),
  )
  if (associated) return normalizeBase(associated.url)
  if (config.capabilities?.includes('smart-app-state')) return iss
  return null
}

/**
 * The scopes to ask for. The app's own data scopes come from app.config.ts; who is signed in
 * (`openid fhirUser`) and App State (`user/Basic.cruds`) are only asked for when the EHR says it
 * offers them, because an EHR may refuse scopes it does not serve.
 */
export function scopeFor(
  discovery: Discovery,
  kind: 'ehr' | 'standalone',
  dataScopes: readonly string[] = appConfig.ehr.scopes,
) {
  const identity = discovery.capabilities.includes('sso-openid-connect')
  const scopes = [
    kind === 'ehr' ? 'launch' : 'launch/patient',
    ...dataScopes,
    ...(identity ? ['openid', 'fhirUser'] : []),
    ...(identity && discovery.appStateEndpoint ? ['user/Basic.cruds'] : []),
  ]
  return [...new Set(scopes)].join(' ')
}

export async function startLaunch(
  settings: SmartSettings,
  params: { iss: string; launch?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ redirectTo: string; pending: PendingLaunch }> {
  const iss = normalizeBase(params.iss)
  if (!isAllowedIssuer(settings, iss)) {
    throw new LaunchError(`This app may not be launched from ${iss}.`)
  }
  const discovery = await discover(iss, fetchImpl)
  const state = randomToken()
  const verifier = randomToken()

  const url = new URL(discovery.authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: settings.clientId,
    redirect_uri: settings.appUrl + CALLBACK_PATH,
    scope: scopeFor(
      discovery,
      params.launch ? 'ehr' : 'standalone',
      settings.scopes,
    ),
    state,
    aud: iss,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    ...(params.launch ? { launch: params.launch } : {}),
  }).toString()

  return {
    redirectTo: url.toString(),
    pending: {
      state,
      verifier,
      iss,
      tokenEndpoint: discovery.tokenEndpoint,
      appStateEndpoint: discovery.appStateEndpoint,
    },
  }
}

export async function finishLaunch(
  settings: SmartSettings,
  pending: PendingLaunch,
  params: {
    code?: string
    state?: string
    error?: string
    errorDescription?: string
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Connection> {
  if (params.error) {
    const detail = params.errorDescription
      ? ` (${params.errorDescription})`
      : ''
    throw new LaunchError(
      `The EHR refused the sign-in: ${params.error}${detail}.`,
    )
  }
  if (!params.code || !params.state || params.state !== pending.state) {
    throw new LaunchError(
      'The sign-in could not be verified. Open the app from the EHR again.',
    )
  }
  const token = await requestToken(
    settings,
    pending.tokenEndpoint,
    {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: settings.appUrl + CALLBACK_PATH,
      code_verifier: pending.verifier,
    },
    fetchImpl,
  )
  const fhirUser = userReference(pending.iss, token)
  const scope = token.scope ?? ''
  const appStateEndpoint =
    pending.appStateEndpoint && fhirUser && /\buser\/Basic\./.test(scope)
      ? pending.appStateEndpoint
      : undefined
  return {
    iss: pending.iss,
    tokenEndpoint: pending.tokenEndpoint,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: now() + (token.expires_in ?? 300),
    scope,
    ...(token.patient ? { patient: token.patient } : {}),
    ...(token.encounter ? { encounter: token.encounter } : {}),
    ...(fhirUser ? { fhirUser } : {}),
    ...(appStateEndpoint ? { appStateEndpoint } : {}),
  }
}

export function needsRefresh(connection: Connection) {
  return connection.expiresAt - EXPIRY_MARGIN <= now()
}

/**
 * Exchanges the refresh token for a new access token. Returns null when there is no refresh
 * token or the EHR ended the grant: the clinician has to open the app again.
 *
 * The EHR rotates refresh tokens and revokes the whole grant when an old one is used twice. Two
 * requests arriving with the same cookie must therefore share one refresh: `inFlight` keeps the
 * answer for a minute, keyed by the refresh token it replaced.
 */
export async function refreshConnection(
  settings: SmartSettings,
  connection: Connection,
  fetchImpl: typeof fetch = fetch,
): Promise<Connection | null> {
  const refreshToken = connection.refreshToken
  if (!refreshToken) return null
  let pending = inFlight.get(refreshToken)
  if (!pending) {
    pending = requestToken(
      settings,
      connection.tokenEndpoint,
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      fetchImpl,
    )
    inFlight.set(refreshToken, pending)
    setTimeout(() => inFlight.delete(refreshToken), 60_000).unref?.()
  }
  let token: TokenResponse
  try {
    token = await pending
  } catch (error) {
    if (error instanceof TokenError && error.status < 500) return null
    throw error
  }
  return {
    ...connection,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: now() + (token.expires_in ?? 300),
    scope: token.scope ?? connection.scope,
  }
}

const inFlight = new Map<string, Promise<TokenResponse>>()

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  patient?: string
  encounter?: string
}

async function requestToken(
  settings: SmartSettings,
  tokenEndpoint: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      ...form,
      client_assertion_type:
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: await clientAssertion(
        settings.privateJwk,
        settings.clientId,
        tokenEndpoint,
      ),
    }).toString(),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    throw new TokenError(res.status, body.error, body.error_description)
  }
  const token = (await res.json()) as TokenResponse
  if (!token.access_token)
    throw new LaunchError('The EHR returned no access token.')
  return token
}

/**
 * The fhirUser claim from the id_token, made absolute against the FHIR server. The id_token
 * came straight from the token endpoint over TLS, which OpenID Connect accepts in place of
 * checking its signature (Core 3.1.3.7).
 */
export function userReference(iss: string, token: { id_token?: string }) {
  if (!token.id_token) return null
  const claim = decodeJwt(token.id_token).fhirUser
  if (typeof claim !== 'string' || !claim) return null
  return /^https?:\/\//.test(claim)
    ? claim
    : `${iss}/${claim.replace(/^\//, '')}`
}

function decodeJwt(jwt: string): Record<string, unknown> {
  try {
    const payload = jwt.split('.')[1] ?? ''
    return JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** A launch problem the clinician can act on; its message is shown to them. */
export class LaunchError extends Error {}

export class TokenError extends LaunchError {
  constructor(
    readonly status: number,
    readonly error?: string,
    description?: string,
  ) {
    super(
      `The EHR's token endpoint answered ${status}${error ? ` ${error}` : ''}${description ? `: ${description}` : ''}.`,
    )
  }
}

const warned = new Set<string>()
function warnOnce(message: string) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

function now() {
  return Math.floor(Date.now() / 1000)
}

function randomToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return toBase64Url(new Uint8Array(digest))
}
