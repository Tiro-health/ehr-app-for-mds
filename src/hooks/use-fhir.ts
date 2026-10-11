import { useCallback, useEffect, useState } from 'react'
import type { Encounter, Patient } from 'fhir/r4'
import { useSmart } from '@/hooks/use-smart'
import { readPatient, searchEncounters } from '@/lib/fhir'
import type { SearchParameters } from '@/lib/fhir'
import type { EhrClient } from '@/lib/smart/client'

/** Data read from the EHR, and where the read is at. */
export type EhrData<T> =
  | { status: 'loading' }
  /** Not opened from a patient's chart, so there is nothing to read. */
  | { status: 'unavailable' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T }

/**
 * Reads from the EHR once the app is connected, and again when `load` changes. Pass a stable
 * `load` (defined outside the component, or wrapped in useCallback).
 */
export function useEhrData<T>(load: (client: EhrClient) => Promise<T>) {
  const smart = useSmart()
  const client = smart.status === 'launched' ? smart.client : null
  const [result, setResult] = useState<EhrData<T>>({ status: 'loading' })

  useEffect(() => {
    if (!client) return
    let cancelled = false
    load(client)
      .then((data) => {
        if (!cancelled) setResult({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      cancelled = true
    }
  }, [client, load])

  if (smart.status === 'loading') return { status: 'loading' } as const
  if (!client) return { status: 'unavailable' } as const
  return result
}

/** The patient the app was opened for. */
export function usePatient(): EhrData<Patient> {
  return useEhrData(readPatient)
}

/** The patient's encounters, most recent first. `status` narrows them, e.g. 'finished'. */
export function useEncounters(
  filter: Partial<Record<SearchParameters['Encounter'], string>> = {},
): EhrData<Encounter[]> {
  const { status, class: encounterClass } = filter
  const load = useCallback(
    (client: EhrClient) =>
      searchEncounters(client, {
        ...(status ? { status } : {}),
        ...(encounterClass ? { class: encounterClass } : {}),
      }),
    [status, encounterClass],
  )
  return useEhrData(load)
}
