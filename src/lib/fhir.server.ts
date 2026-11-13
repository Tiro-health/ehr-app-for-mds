import { getRequestHeader } from '@tanstack/react-start/server'
import { createFhirClient } from '@/lib/fhir/sidecar-client'

/**
 * The EHR, for use on the server only: in server functions and route loaders.
 *
 *   const { patient } = await fhir.context()
 *   const record = await fhir.read('Patient', patient)
 *   const visits = await fhir.search('Encounter', { status: 'finished' })
 *
 * It answers for the visitor of the request being handled. See the `connect-to-ehr` skill.
 */
export const fhir = createFhirClient(() => getRequestHeader('cookie'))

export {
  FhirRequestError,
  NotLaunchedError,
  ScopeRefusedError,
} from '@/lib/fhir/errors'
export type { LaunchContext, NewDocument } from '@/lib/fhir/sidecar-client'
