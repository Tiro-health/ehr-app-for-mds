import type { Basic, FhirResource } from 'fhir/r4'

// The key of an external service (the AI service), as the EHR shares it with the app: an
// EHRApiKey, a `Basic` of the kind `api-key`. See the FHIR guide, "EHR API Key".
//
// The key is a secret. It is read on the server, used for one request and forgotten: never
// sent to the browser, logged, kept in a variable outside a function or put in an error.

const KIND_SYSTEM = 'urn:tiro-health:basic-kind'
const KIND_CODE = 'api-key'
const PROVIDER_URL =
  'https://ehr.tiro.health/fhir/StructureDefinition/api-key-provider'
const VALUE_URL =
  'https://ehr.tiro.health/fhir/StructureDefinition/api-key-value'

export type ApiKeyProvider = 'gemini'

/** The search that finds the key of one service. */
export const apiKeySearch = (provider: ApiKeyProvider) => ({
  code: `${KIND_SYSTEM}|${KIND_CODE}`,
  provider,
})

/** The scope the app needs to read the key of one service; it belongs in smart.json. */
export const apiKeyScope = (provider: ApiKeyProvider) =>
  `user/Basic.rs?code=${KIND_SYSTEM}|${KIND_CODE}&provider=${provider}`

/** Whether a resource holds a key: such a resource must never reach the browser. */
export function isApiKey(resource: FhirResource): boolean {
  return (
    resource.resourceType === 'Basic' &&
    (resource.code?.coding ?? []).some(
      (coding) => coding.system === KIND_SYSTEM && coding.code === KIND_CODE,
    )
  )
}

/** The key of `provider` among what a search returned, or null when the EHR has none. */
export function apiKeyValue(
  resources: Basic[],
  provider: ApiKeyProvider,
): string | null {
  for (const resource of resources) {
    if (!isApiKey(resource)) continue
    const extensions = resource.extension ?? []
    const named = extensions.find((e) => e.url === PROVIDER_URL)?.valueCode
    const value = extensions.find((e) => e.url === VALUE_URL)?.valueString
    if (named === provider && value) return value
  }
  return null
}
