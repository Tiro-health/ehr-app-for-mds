/**
 * Typed reads and writes against the EHR's FHIR R4 API, on top of the launch's EhrClient.
 * Resource types come from @types/fhir.
 *
 * The Tiro EHR's FHIR API matches search parameters exactly and answers 400 to one it does not
 * know, so searches only accept the parameters it serves (`SearchParameters`). Searches are
 * always limited to the launched patient by the access token itself.
 */
import type {
  Bundle,
  DocumentReference,
  Encounter,
  FhirResource,
  HumanName,
  Patient,
} from 'fhir/r4'
import type { EhrClient } from '@/lib/smart/client'

/** The search parameters the Tiro EHR serves, per resource type. */
export type SearchParameters = {
  Patient: 'gender' | 'family' | 'given' | 'identifier'
  Encounter: 'status' | 'class'
  DocumentReference: 'patient' | 'subject' | 'identifier'
}

type Searchable = keyof SearchParameters
type ResourceOf<T extends Searchable> = Extract<
  FhirResource,
  { resourceType: T }
>

export async function readPatient(client: EhrClient): Promise<Patient> {
  const id = client.patientId
  if (!id) throw new Error('The EHR did not say which patient this is.')
  return client.json<Patient>(`Patient/${encodeURIComponent(id)}`)
}

/**
 * Searches one resource type and follows the EHR's next-page links, up to `max` results.
 */
export async function search<T extends Searchable>(
  client: EhrClient,
  resourceType: T,
  params: Partial<Record<SearchParameters[T], string>> = {},
  { max = 200, pageSize = 50 }: { max?: number; pageSize?: number } = {},
): Promise<ResourceOf<T>[]> {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(name, value)
  }
  query.set('_count', String(Math.min(pageSize, max)))
  let next: string | undefined = `${resourceType}?${query}`
  const found: ResourceOf<T>[] = []
  while (next && found.length < max) {
    const bundle: Bundle = await client.json<Bundle>(next)
    for (const entry of bundle.entry ?? []) {
      if (entry.resource?.resourceType === resourceType)
        found.push(entry.resource as ResourceOf<T>)
    }
    const link = bundle.link?.find((l) => l.relation === 'next')?.url
    // Only follow links back to the same EHR: the token must not go anywhere else.
    next = link?.startsWith(`${client.fhirBase}/`) ? link : undefined
  }
  return found.slice(0, max)
}

/** The patient's encounters, most recent first. */
export async function searchEncounters(
  client: EhrClient,
  params: Partial<Record<SearchParameters['Encounter'], string>> = {},
): Promise<Encounter[]> {
  const encounters = await search(client, 'Encounter', params)
  return encounters.sort((a, b) =>
    (b.period?.start ?? '').localeCompare(a.period?.start ?? ''),
  )
}

/** The patient's documents, most recent first. Needs `patient/DocumentReference.rs`. */
export async function searchDocuments(
  client: EhrClient,
): Promise<DocumentReference[]> {
  const documents = await search(client, 'DocumentReference')
  return documents.sort((a, b) =>
    (documentDay(b) ?? '').localeCompare(documentDay(a) ?? ''),
  )
}

/**
 * The day a document was made, or else filed (YYYY-MM-DD, or a longer dateTime). Documents an app
 * files have no `date` of their own: the EHR refuses one.
 */
export function documentDay(document: DocumentReference) {
  return (
    document.content[0]?.attachment?.creation ??
    document.date ??
    document.meta?.lastUpdated
  )
}

/** The EHR's code system for document kinds (`Brief`, `Labo`, ...). */
export const DOCUMENT_KIND_SYSTEM = 'urn:tv:document-kind'

/**
 * Document kinds the clinic files under. Each clinic keeps its own list; these are the usual
 * ones. `encounter_note` and `quote` are locked and cannot be filed by an app.
 */
export type DocumentKind =
  | 'letter'
  | 'referral'
  | 'lab'
  | 'imaging'
  | 'ecg'
  | 'operative_report'
  | 'scan'
  | 'questionnaire'
  | 'chart_sheet'
  | 'drawing'
  | 'consent'
  | 'treatment_record'
  | 'other'
  | (string & {})

/** File types the EHR stores. */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

/** The EHR takes files up to 10 MiB inline. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export type NewDocument = {
  kind: DocumentKind
  /** File name shown in the patient's documents. */
  title: string
  contentType: (typeof DOCUMENT_CONTENT_TYPES)[number]
  /** The file itself. */
  data: Blob | Uint8Array
  /** A short note shown with the document. */
  description?: string
  /** The day the document was made, YYYY-MM-DD. */
  created?: string
}

/**
 * Files a document in the launched patient's record. Needs the `patient/DocumentReference.c`
 * scope in app.config.ts. `date` and `context` are left out on purpose: the EHR refuses them.
 */
export async function createDocumentReference(
  client: EhrClient,
  document: NewDocument,
): Promise<DocumentReference> {
  const patient = client.patientId
  if (!patient) throw new Error('The EHR did not say which patient this is.')
  if (!DOCUMENT_CONTENT_TYPES.includes(document.contentType)) {
    throw new Error(`The EHR does not store ${document.contentType} files.`)
  }
  const bytes =
    document.data instanceof Uint8Array
      ? document.data
      : new Uint8Array(await document.data.arrayBuffer())
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('The file is larger than the 10 MiB the EHR accepts.')
  }
  const resource: DocumentReference = {
    resourceType: 'DocumentReference',
    status: 'current',
    type: { coding: [{ system: DOCUMENT_KIND_SYSTEM, code: document.kind }] },
    subject: { reference: `Patient/${patient}` },
    ...(document.description ? { description: document.description } : {}),
    content: [
      {
        attachment: {
          contentType: document.contentType,
          title: document.title,
          data: toBase64(bytes),
          ...(document.created ? { creation: document.created } : {}),
        },
      },
    ],
  }
  return client.json<DocumentReference>('DocumentReference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(resource),
  })
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** "Joachim Reyskens", from the official (or first) name. */
export function formatName(names: HumanName[] | undefined) {
  const name = names?.find((n) => n.use === 'official') ?? names?.[0]
  if (!name) return ''
  if (name.text) return name.text
  return [...(name.prefix ?? []), ...(name.given ?? []), name.family]
    .filter(Boolean)
    .join(' ')
}

/** Age in whole years on `on`, from a FHIR date (YYYY, YYYY-MM or YYYY-MM-DD). */
export function ageInYears(birthDate: string, on = new Date()) {
  const [y, m = 1, d = 1] = birthDate.split('-').map(Number)
  let age = on.getFullYear() - y
  if (on.getMonth() + 1 < m || (on.getMonth() + 1 === m && on.getDate() < d))
    age -= 1
  return age
}
