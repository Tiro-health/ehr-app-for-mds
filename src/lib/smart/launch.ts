/**
 * SMART on FHIR launch as a confidential client: discovery, the authorization redirect and
 * the code exchange. Runs on the server only; the client secret never reaches the browser.
 * https://hl7.org/fhir/smart-app-launch/app-launch.html
 */

export type SmartSettings = {
  clientId: string
  clientSecret: string
  /** FHIR base URLs this app may be launched from. Anything else is refused. */
  allowedIssuers: string[]
  /** Public origin of this app, e.g. https://my-app.tirohealth.app */
  appUrl: string
  scope: string
}

export type SmartConfiguration = {
  authorization_endpoint: string
  token_endpoint: string
  capabilities?: string[]
  associated_endpoints?: { url: string; capabilities?: string[] }[]
}

export type PendingLaunch = {
  state: string
  verifier: string
  iss: string
  tokenEndpoint: string
  appStateEndpoint: string
}

export type Connection = {
  iss: string
  appStateEndpoint: string
  tokenEndpoint: string
  accessToken: string
  refreshToken?: string
  /** Epoch seconds. */
  expiresAt: number
  /** Absolute reference to the signed-in user (Practitioner, PractitionerRole, ...). */
  fhirUser: string
}

const DEFAULT_SCOPE = 'openid fhirUser launch user/Basic.cruds'

export const CALLBACK_PATH = '/smart/callback'

/** Returns null when the deploy has no SMART settings: the app then saves on the device. */
export function readSettings(env = process.env): SmartSettings | null {
  const clientId = env.SMART_CLIENT_ID
  const clientSecret = env.SMART_CLIENT_SECRET
  const issuers = env.SMART_ISS
  const appUrl = env.APP_URL
  if (!clientId || !clientSecret || !issuers || !appUrl) return null
  return {
    clientId,
    clientSecret,
    allowedIssuers: issuers.split(',').map(normalizeBase).filter(Boolean),
    appUrl: appUrl.replace(/\/$/, ''),
    scope: env.SMART_SCOPE || DEFAULT_SCOPE,
  }
}

export function normalizeBase(url: string) {
  return url.trim().replace(/\/$/, '')
}

export async function discover(
  iss: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ config: SmartConfiguration; appStateEndpoint: string }> {
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
  const appStateEndpoint = findAppStateEndpoint(iss, config)
  if (!appStateEndpoint) {
    throw new Error(
      'This EHR does not support SMART App State (smart-app-state).',
    )
  }
  return { config, appStateEndpoint }
}

/** The main FHIR server, or an associated endpoint that advertises smart-app-state. */
export function findAppStateEndpoint(iss: string, config: SmartConfiguration) {
  const associated = config.associated_endpoints?.find((e) =>
    e.capabilities?.includes('smart-app-state'),
  )
  if (associated) return normalizeBase(associated.url)
  if (config.capabilities?.includes('smart-app-state')) return iss
  return null
}

export async function startLaunch(
  settings: SmartSettings,
  params: { iss: string; launch?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ redirectTo: string; pending: PendingLaunch }> {
  const iss = normalizeBase(params.iss)
  if (!settings.allowedIssuers.includes(iss)) {
    throw new LaunchError(`This app may not be launched from ${iss}.`)
  }
  const { config, appStateEndpoint } = await discover(iss, fetchImpl)
  const state = randomToken()
  const verifier = randomToken()
  const scope = params.launch
    ? settings.scope
    : settings.scope
        .split(/\s+/)
        .filter((s) => s && s !== 'launch')
        .join(' ')

  const url = new URL(config.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: settings.clientId,
    redirect_uri: settings.appUrl + CALLBACK_PATH,
    scope,
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
      tokenEndpoint: config.token_endpoint,
      appStateEndpoint,
    },
  }
}

export async function finishLaunch(
  settings: SmartSettings,
  pending: PendingLaunch,
  params: { code?: string; state?: string; error?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Connection> {
  if (params.error)
    throw new LaunchError(`The EHR refused the sign-in: ${params.error}.`)
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
  if (!fhirUser) {
    throw new LaunchError('The EHR did not say who is signed in (no fhirUser).')
  }
  return {
    iss: pending.iss,
    appStateEndpoint: pending.appStateEndpoint,
    tokenEndpoint: pending.tokenEndpoint,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: now() + (token.expires_in ?? 300),
    fhirUser,
  }
}

/** Refreshes the access token shortly before it expires, when the EHR gave a refresh token. */
export async function freshConnection(
  settings: SmartSettings,
  connection: Connection,
  fetchImpl: typeof fetch = fetch,
): Promise<Connection | null> {
  if (connection.expiresAt - 30 > now()) return connection
  if (!connection.refreshToken) return null
  const token = await requestToken(
    settings,
    connection.tokenEndpoint,
    { grant_type: 'refresh_token', refresh_token: connection.refreshToken },
    fetchImpl,
  )
  return {
    ...connection,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? connection.refreshToken,
    expiresAt: now() + (token.expires_in ?? 300),
  }
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  fhirUser?: string
}

async function requestToken(
  settings: SmartSettings,
  tokenEndpoint: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const basic = btoa(
    `${encodeURIComponent(settings.clientId)}:${encodeURIComponent(settings.clientSecret)}`,
  )
  const res = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  })
  if (!res.ok)
    throw new LaunchError(`The EHR's token endpoint answered ${res.status}.`)
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
export function userReference(iss: string, token: TokenResponse) {
  const claim = token.id_token
    ? decodeJwt(token.id_token).fhirUser
    : token.fhirUser
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

export class LaunchError extends Error {}

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

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
