import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { QueryClient, UseQueryResult } from '@tanstack/react-query'
import type { FhirResource } from 'fhir/r4'
import {
  ehrContext,
  ehrCreate,
  ehrDelete,
  ehrRead,
  ehrSearch,
  ehrUpdate,
} from '@/lib/ehr.functions'
import type { FromEhr } from '@/lib/fhir/from-ehr'
import type {
  ResourceOf,
  ResourceType,
  SearchParams,
} from '@/lib/fhir/sidecar-client'

// Hooks that give a page data from the EHR. The page decides what it needs:
//
//   const { patient, launched } = usePatient()
//   const { resources } = useFhirSearch('Encounter', { status: 'finished' })
//   const { resource } = useFhirRead('Encounter', id)
//   const update = useFhirUpdate()   // update.mutate({ ...resource, status: 'finished' })
//
// `launched` is false when the app was opened directly instead of from the EHR; the page
// then simply has no patient. The matching `...Query` can be preloaded in a route's loader
// so the data is already there when the page first appears (see src/routes/index.tsx).

type SearchResult<T extends ResourceType> = {
  matches: ResourceOf<T>[]
  included: FhirResource[]
}

export const contextQuery = queryOptions({
  queryKey: ['ehr', 'context'],
  queryFn: () => ehrContext(),
})

export function readQuery<T extends ResourceType>(
  type: T,
  id: string | null | undefined,
) {
  return queryOptions({
    queryKey: ['ehr', 'read', type, id],
    queryFn: id
      ? async () =>
          (await ehrRead({ data: { type, id } })) as FromEhr<ResourceOf<T>>
      : skipToken,
  })
}

export function searchQuery<T extends ResourceType>(
  type: T,
  params: SearchParams = {},
  { max }: { max?: number } = {},
) {
  return queryOptions({
    queryKey: ['ehr', 'search', type, params, max],
    queryFn: async () =>
      (await ehrSearch({ data: { type, params, max } })) as FromEhr<
        SearchResult<T>
      >,
  })
}

/** Preloads the launched patient in a route loader. */
export async function preloadPatient(queryClient: QueryClient) {
  await queryClient.prefetchQuery(contextQuery)
  const answer = queryClient.getQueryData(contextQuery.queryKey)
  if (answer?.launched && answer.data.patient) {
    await queryClient.prefetchQuery(readQuery('Patient', answer.data.patient))
  }
}

function unwrap<T>(query: UseQueryResult<FromEhr<T>>) {
  const answer = query.data
  return {
    data: answer?.launched ? answer.data : undefined,
    launched: answer?.launched ?? false,
    isLoading: query.isLoading,
    error: query.error,
  }
}

/** What the EHR told the app at launch: ids of the patient, encounter and user, and the granted permissions. */
export function useEhrContext() {
  const { data, ...rest } = unwrap(useQuery(contextQuery))
  return { context: data ?? null, ...rest }
}

/** One resource of any type by its id. Waits while `id` is not known yet. */
export function useFhirRead<T extends ResourceType>(
  type: T,
  id: string | null | undefined,
) {
  const { data, ...rest } = unwrap(useQuery(readQuery(type, id)))
  return { resource: data ?? null, ...rest }
}

/** A search of any type, with any parameters the EHR accepts. */
export function useFhirSearch<T extends ResourceType>(
  type: T,
  params?: SearchParams,
  options?: { max?: number },
) {
  const { data, ...rest } = unwrap(useQuery(searchQuery(type, params, options)))
  return {
    resources: data?.matches ?? [],
    included: data?.included ?? [],
    ...rest,
  }
}

/** The patient whose record was open in the EHR when the app was launched. */
export function usePatient() {
  const launch = useEhrContext()
  const read = useFhirRead('Patient', launch.context?.patient)
  return {
    patient: read.resource,
    launched: launch.launched,
    isLoading: launch.isLoading || read.isLoading,
    error: launch.error ?? read.error,
  }
}

/** The launched patient's encounters, most recent first. */
export function useEncounters() {
  const { resources, ...rest } = useFhirSearch('Encounter')
  const encounters = [...resources].sort((a, b) =>
    (b.period?.start ?? '').localeCompare(a.period?.start ?? ''),
  )
  return { encounters, ...rest }
}

// Writing. Each returns a TanStack mutation: `mutate(resource)`, `isPending`, `error`.
// After a write, everything read from the EHR is fetched again.

function useEhrWrite<R extends FhirResource, T>(
  write: (input: { data: R }) => Promise<FromEhr<T>>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (resource: R) => {
      const answer = await write({ data: resource })
      if (!answer.launched) {
        throw new Error('The app was not opened from the EHR.')
      }
      return answer.data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ehr'] }),
  })
}

/** Creates a resource in the EHR. */
export function useFhirCreate<R extends FhirResource = FhirResource>() {
  return useEhrWrite<R, R>(
    ehrCreate as (input: { data: R }) => Promise<FromEhr<R>>,
  )
}

/** Replaces a resource: pass the copy that was read, with the changes. */
export function useFhirUpdate<R extends FhirResource = FhirResource>() {
  return useEhrWrite<R, R>(
    ehrUpdate as (input: { data: R }) => Promise<FromEhr<R>>,
  )
}

/** Deletes a resource: pass it as it was read. */
export function useFhirDelete() {
  return useEhrWrite<FhirResource, null>(ehrDelete)
}
