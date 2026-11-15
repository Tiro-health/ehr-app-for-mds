import { createServerFn } from '@tanstack/react-start'
import { readState, writeState } from '@/lib/app-state'
import type { AppStateTarget, Json } from '@/lib/app-state'
import { NotLaunchedError, fhir } from '@/lib/fhir.server'
import { fromEhr } from '@/lib/fhir/from-ehr'

// Server functions behind useAppState (src/hooks/use-app-state.ts). They save the app's
// settings for the signed-in clinician in the EHR. Settings only: never patient data.

const fail = (): never => {
  throw new TypeError('Not a valid request.')
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail()
const key = (value: unknown): string =>
  typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value) ? value : fail()
const origin = (value: unknown): string => {
  if (typeof value !== 'string' || !URL.canParse(value)) return fail()
  const url = new URL(value)
  return /^https?:$/.test(url.protocol) && url.origin === value ? value : fail()
}

/** Whose state it is. Without a signed-in user the page keeps it on the device instead. */
async function target(system: string): Promise<AppStateTarget> {
  const { fhirUser } = await fhir.context()
  if (!fhirUser) throw new NotLaunchedError()
  return { fhir, system, subject: fhirUser }
}

/** The stored state for one key, or null when nothing was saved yet. */
export const appStateRead = createServerFn({ method: 'POST' })
  .inputValidator((input: { system: string; key: string }) => ({
    system: origin(record(input).system),
    key: key(input.key),
  }))
  .handler(({ data }) =>
    fromEhr(async () => readState(await target(data.system), data.key)),
  )

/** Saves one key, based on the version that was read (`current`), or creates it. */
export const appStateWrite = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      system: string
      key: string
      value: Json
      current: { id: string; version: string } | null
    }) => {
      const current =
        record(input).current === null ? null : record(input.current)
      return {
        system: origin(input.system),
        key: key(input.key),
        value: input.value,
        current: current && {
          id: typeof current.id === 'string' ? current.id : fail(),
          version:
            typeof current.version === 'string' ? current.version : fail(),
        },
      }
    },
  )
  .handler(({ data }) =>
    fromEhr(async () =>
      writeState(await target(data.system), data.key, data.value, data.current),
    ),
  )
