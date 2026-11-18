import { createServerFn } from '@tanstack/react-start'
import type { FhirResource } from 'fhir/r4'
import { fhir } from '@/lib/fhir.server'
import type { SearchParams } from '@/lib/fhir.server'
import { isApiKey } from '@/lib/fhir/api-key'
import { fromEhr } from '@/lib/fhir/from-ehr'
import type { ResourceType } from '@/lib/fhir/sidecar-client'

// Server functions: they run on the app's server and are called from pages, through the
// hooks in src/hooks/ehr.ts. They know no resource type: the page says what it wants, and the
// EHR decides what this visitor may have (the launch, and the permissions the clinic granted).
//
// Patient data passes through here on its way to the page. Read the rules in CLAUDE.md
// ("Patient data from the EHR") before changing anything: do not log it, do not keep it, do
// not send it anywhere else. Add a function of your own only when the server must combine or
// trim data before the page gets it.

const fail = (): never => {
  throw new TypeError('Not a valid request.')
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail()
const string = (value: unknown): string =>
  typeof value === 'string' ? value : fail()
const resource = (value: unknown): FhirResource => {
  string(record(value).resourceType)
  return value as FhirResource
}

// A key the EHR shares with the app (an EHRApiKey) is for the server only. These functions
// answer the browser, so they never return one, whatever the page asks for.
const noApiKey = <T extends FhirResource>(resource: T): T =>
  isApiKey(resource) ? fail() : resource

/** What the EHR told the app when it opened it: patient, encounter, user, permissions. */
export const ehrContext = createServerFn({ method: 'POST' }).handler(() =>
  fromEhr(() => fhir.context()),
)

/** One resource by type and id. */
export const ehrRead = createServerFn({ method: 'POST' })
  .inputValidator((input: { type: string; id: string }) => ({
    type: string(record(input).type) as ResourceType,
    id: string(input.id),
  }))
  .handler(({ data }) =>
    fromEhr(async () => noApiKey(await fhir.read(data.type, data.id))),
  )

/** A search: the matches, and what the EHR sent along with them. */
export const ehrSearch = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { type: string; params?: SearchParams; max?: number }) => {
      const params: SearchParams = {}
      for (const [name, value] of Object.entries(
        record(record(input).params ?? {}),
      )) {
        if (value === undefined) continue
        params[name] = Array.isArray(value) ? value.map(string) : string(value)
      }
      const max = input.max
      if (max !== undefined && !(Number.isInteger(max) && max > 0)) fail()
      return { type: string(input.type) as ResourceType, params, max }
    },
  )
  .handler(({ data }) =>
    fromEhr(async () => {
      const found = await fhir.searchWithIncluded(data.type, data.params, {
        max: data.max,
      })
      return {
        matches: found.matches.filter((resource) => !isApiKey(resource)),
        included: found.included.filter((resource) => !isApiKey(resource)),
      }
    }),
  )

/** Creates a resource and returns it as stored. */
export const ehrCreate = createServerFn({ method: 'POST' })
  .inputValidator((input: FhirResource) => resource(input))
  .handler(({ data }) => fromEhr(() => fhir.create(data)))

/** Replaces a resource (as read, then changed) and returns it as stored. */
export const ehrUpdate = createServerFn({ method: 'POST' })
  .inputValidator((input: FhirResource) => resource(input))
  .handler(({ data }) => fromEhr(() => fhir.update(data)))

/** Deletes a resource, given as it was read. */
export const ehrDelete = createServerFn({ method: 'POST' })
  .inputValidator((input: FhirResource) => resource(input))
  .handler(({ data }) => fromEhr(() => fhir.delete(data).then(() => null)))
