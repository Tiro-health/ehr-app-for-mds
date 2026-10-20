/**
 * The EHR connection, as Tiro's auth proxy hands it to the browser. On tirohealth.app the proxy
 * answers every app's `/_tiro/auth/*` and `/.well-known/jwks.json`: it does the SMART launch and
 * keeps the sign-in, so this app holds no key and no refresh token. The browser gets the
 * short-lived access token and reads the patient's data from the EHR itself.
 */

/** What the browser needs to read from the EHR itself. Never patient data. */
export type EhrConnection =
  /** Nothing answers /_tiro/auth/token: local development without the auth proxy. */
  | { status: 'not-configured' }
  /** Opened directly, or the last launch failed (`error` says why). */
  | { status: 'not-launched'; error?: string }
  /** The EHR ended the sign-in (expired, revoked, or signed out). */
  | { status: 'ended' }
  | {
      status: 'launched'
      fhirBase: string
      accessToken: string
      /** Epoch seconds. */
      expiresAt: number
      scope: string
      patient?: string
      encounter?: string
      fhirUser?: string
      appStateEndpoint?: string
    }

/**
 * Asks the auth proxy for the connection. It refreshes the access token when it is about to run
 * out, or when the EHR just refused it (`rejected`).
 */
export async function connectToEhr(rejected?: string): Promise<EhrConnection> {
  const res = await fetch('/_tiro/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rejected ? { rejected } : {}),
  })
  if (res.status === 404) return { status: 'not-configured' }
  if (!res.ok) throw new Error(`The sign-in service answered ${res.status}.`)
  return (await res.json()) as EhrConnection
}
