import { getRequestHeader } from '@tanstack/react-start/server'
import manifest from '../../smart.json'
import { createDocumentReference } from '@/lib/fhir/documents'
import type { NewDocument } from '@/lib/fhir/documents'
import { createFhirClient } from '@/lib/fhir/sidecar-client'

const client = createFhirClient(() => getRequestHeader('cookie'), {
  asked: manifest.scopes,
})

/**
 * The EHR, for use on the server only: in server functions and route loaders. It works for
 * any resource type the EHR serves; it has no list of types or search parameters of its own.
 *
 *   const { patient } = await fhir.context()
 *   const record = await fhir.read('Patient', patient)
 *   const visits = await fhir.search('Encounter', { status: 'finished' })
 *   const { matches, included } = await fhir.searchWithIncluded('Encounter', { _include: '...' })
 *   const made = await fhir.create({ resourceType: 'Basic', ... })
 *   const changed = await fhir.update({ ...made, code: ... })   // needs id and meta.versionId
 *   await fhir.delete(changed)
 *   const statement = await fhir.request('GET', 'metadata')    // anything else under the FHIR base
 *   const filed = await fhir.createDocumentReference({ type, title, contentType, data })
 *
 * It answers for the visitor of the request being handled. See the `connect-to-ehr` skill.
 */
export const fhir = {
  ...client,
  /** Files a document (a PDF, a text, an image) in the launched patient's record. */
  createDocumentReference: (document: NewDocument) =>
    createDocumentReference(client, document),
}

export {
  FhirRequestError,
  NotLaunchedError,
  ScopeRefusedError,
} from '@/lib/fhir/errors'
export type { NewDocument } from '@/lib/fhir/documents'
export type {
  LaunchContext,
  RequestOptions,
  SearchOptions,
  SearchParams,
} from '@/lib/fhir/sidecar-client'
