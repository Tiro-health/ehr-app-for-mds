import { createServerFn } from '@tanstack/react-start'
import { needsRefresh, readSettings, refreshConnection } from './launch'
import type { Connection } from './launch'
import { smartSession } from './session'

/** What the browser needs to read from the EHR itself. Never patient data. */
export type EhrConnection =
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
 * Hands the browser the short-lived access token from the session cookie, refreshing it first
 * when it is about to run out, or when the EHR just refused it (`rejected`).
 *
 * A POST, so the SameSite=Lax cookie is never sent with another site's request to it.
 */
export const getEhrConnection = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const rejected = (input as { rejected?: unknown } | undefined)?.rejected
    return { rejected: typeof rejected === 'string' ? rejected : undefined }
  })
  .handler(async ({ data }): Promise<EhrConnection> => {
    const settings = readSettings()
    if (!settings) return { status: 'not-configured' }
    const session = await smartSession(settings.appUrl)
    const connection = session.data.connection
    if (!connection) {
      const error = session.data.launchError
      if (error) await session.update({ launchError: undefined })
      return { status: 'not-launched', ...(error ? { error } : {}) }
    }

    // Only refresh for a rejected token if the cookie still holds that token: another request
    // may already have replaced it.
    const rejected = data.rejected === connection.accessToken
    if (!rejected && !needsRefresh(connection)) return forBrowser(connection)

    const fresh = await refreshConnection(settings, connection)
    if (!fresh) {
      await session.update({ connection: undefined })
      return { status: 'ended' }
    }
    await session.update({ connection: fresh })
    return forBrowser(fresh)
  })

function forBrowser(connection: Connection): EhrConnection {
  return {
    status: 'launched',
    fhirBase: connection.iss,
    accessToken: connection.accessToken,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    ...(connection.patient ? { patient: connection.patient } : {}),
    ...(connection.encounter ? { encounter: connection.encounter } : {}),
    ...(connection.fhirUser ? { fhirUser: connection.fhirUser } : {}),
    ...(connection.appStateEndpoint
      ? { appStateEndpoint: connection.appStateEndpoint }
      : {}),
  }
}
