import { queryOptions, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { FromEhr } from '@/lib/fhir/from-ehr'
import { getEncounters, getPatient } from '@/lib/ehr.functions'

// Hooks that give a page data from the EHR.
//
//   const { patient, launched, isLoading } = usePatient()
//
// `launched` is false when the app was opened directly instead of from the EHR; the page
// then simply has no patient. The matching `...Query` can be preloaded in a route's loader
// so the data is already there when the page first appears (see src/routes/index.tsx).

export const patientQuery = queryOptions({
  queryKey: ['ehr', 'patient'],
  queryFn: () => getPatient(),
})

export const encountersQuery = queryOptions({
  queryKey: ['ehr', 'encounters'],
  queryFn: () => getEncounters(),
})

function unwrap<T>(query: UseQueryResult<FromEhr<T>>) {
  const answer = query.data
  return {
    data: answer?.launched ? answer.data : undefined,
    launched: answer?.launched ?? false,
    isLoading: query.isPending,
    error: query.error,
  }
}

/** The patient whose record was open in the EHR when the app was launched. */
export function usePatient() {
  const { data, ...rest } = unwrap(useQuery(patientQuery))
  return { patient: data ?? null, ...rest }
}

/** The launched patient's encounters, most recent first. */
export function useEncounters() {
  const { data, ...rest } = unwrap(useQuery(encountersQuery))
  return { encounters: data ?? [], ...rest }
}
