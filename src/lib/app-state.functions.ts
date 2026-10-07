import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import {
  readState,
  writeState,
  type AppStateTarget,
  type Json,
} from '@/lib/smart/app-state'
import { freshConnection, readSettings } from '@/lib/smart/launch'
import { smartSession } from '@/lib/smart/session'

/**
 * Server functions behind useAppState. They only relay between the browser and the EHR's App
 * State endpoint using the sign-in in the session cookie; nothing is kept on this server.
 */

export const loadAppState = createServerFn({ method: 'GET' })
  .inputValidator(validateKey)
  .handler(async ({ data }) => {
    const target = await currentTarget()
    if (!target) return { connected: false as const }
    const state = await readState(target, data.key)
    return { connected: true as const, state }
  })

export const saveAppState = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => {
    const { key } = validateKey(input)
    const { value, current } = input as {
      value: Json
      current: { id: string; version: string } | null
    }
    if (
      current !== null &&
      (typeof current?.id !== 'string' || typeof current?.version !== 'string')
    ) {
      throw new Error('Invalid app state version.')
    }
    return { key, value, current }
  })
  .handler(async ({ data }) => {
    const target = await currentTarget({ write: true })
    if (!target) return { connected: false as const }
    const result = await writeState(target, data.key, data.value, data.current)
    return { connected: true as const, result }
  })

/** State codes are short, stable names chosen by the page, like "click-count". */
function validateKey(input: unknown) {
  const key = (input as { key?: unknown })?.key
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
    throw new Error('App state keys use lowercase letters, digits and dashes.')
  }
  return { key }
}

async function currentTarget(
  options: { write?: boolean } = {},
): Promise<AppStateTarget | null> {
  const settings = readSettings()
  if (!settings) return null
  // The sign-in cookie is SameSite=None so it works inside an EHR frame; that means another
  // site could send it along. Writes must come from this app's own pages.
  if (
    options.write &&
    getRequestHeader('origin') !== new URL(settings.appUrl).origin
  ) {
    throw new Error('App state can only be saved from this app.')
  }
  const session = await smartSession()
  const connection = session.data.connection
  if (!connection) return null
  const fresh = await freshConnection(settings, connection)
  if (!fresh) {
    await session.update({ connection: undefined })
    return null
  }
  if (fresh !== connection) await session.update({ connection: fresh })
  return {
    endpoint: fresh.appStateEndpoint,
    accessToken: fresh.accessToken,
    system: settings.appUrl,
    subject: fresh.fhirUser,
  }
}
