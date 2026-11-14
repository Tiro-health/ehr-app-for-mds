import type { Coding, DocumentReference } from 'fhir/r4'
import { NotLaunchedError } from '@/lib/fhir/errors'
import type { FhirClient } from '@/lib/fhir/sidecar-client'

// Filing a document in the launched patient's record, the way the Tiro EHR wants it. This is
// the one place that knows the shape of a DocumentReference; the FHIR helper itself does not.

export const DOCUMENT_KIND_SYSTEM = 'urn:tiro-health:document-kind'
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export interface NewDocument {
  /** A code from the clinic's document kinds, or a full Coding. */
  type: string | Coding
  title: string
  /** For example "application/pdf" or "text/plain". */
  contentType: string
  /** The file itself: bytes, or text. At most 10 MiB. */
  data: Uint8Array | string
  description?: string
}

/** Files a document (a PDF, a text, an image) in the launched patient's record. */
export async function createDocumentReference(
  fhir: Pick<FhirClient, 'context' | 'create'>,
  document: NewDocument,
): Promise<DocumentReference> {
  const bytes =
    typeof document.data === 'string'
      ? new TextEncoder().encode(document.data)
      : document.data
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new RangeError('The document is larger than 10 MiB.')
  }
  const { patient } = await fhir.context()
  if (!patient) throw new NotLaunchedError()

  const coding: Coding =
    typeof document.type === 'string'
      ? { system: DOCUMENT_KIND_SYSTEM, code: document.type }
      : document.type

  // The EHR sets the date itself and refuses a document that carries "date" or "context".
  return fhir.create<DocumentReference>({
    resourceType: 'DocumentReference',
    status: 'current',
    type: { coding: [coding] },
    subject: { reference: `Patient/${patient}` },
    description: document.description,
    content: [
      {
        attachment: {
          contentType: document.contentType,
          title: document.title,
          data: Buffer.from(bytes).toString('base64'),
        },
      },
    ],
  })
}
