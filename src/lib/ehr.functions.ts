import { createServerFn } from '@tanstack/react-start'
import { fhir } from '@/lib/fhir.server'
import { fromEhr } from '@/lib/fhir/from-ehr'

// Server functions: they run on the app's server and are called from pages.
// Patient data passes through here on its way to the page. Read the rules in CLAUDE.md
// ("Patient data from the EHR") before adding one: do not log it, do not keep it, do not
// send it anywhere else.

/** The patient whose record was open in the EHR, or null when launched without one. */
export const getPatient = createServerFn({ method: 'POST' }).handler(() =>
  fromEhr(async () => {
    const { patient } = await fhir.context()
    return patient ? await fhir.read('Patient', patient) : null
  }),
)

/** The launched patient's encounters, most recent first. */
export const getEncounters = createServerFn({ method: 'POST' }).handler(() =>
  fromEhr(async () => {
    const encounters = await fhir.search('Encounter')
    return encounters.sort((a, b) =>
      (b.period?.start ?? '').localeCompare(a.period?.start ?? ''),
    )
  }),
)
