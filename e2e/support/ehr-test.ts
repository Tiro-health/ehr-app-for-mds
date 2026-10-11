/**
 * Playwright's `test`, plus what a page opened from the local Tiro EHR needs:
 *
 *   import { expect, test } from './support/ehr-test'
 *
 *   test('shows the patient', async ({ openFromChart, chartPatient }) => {
 *     const app = await openFromChart()
 *     await expect(app.getByText(chartPatient.family)).toBeVisible()
 *   })
 *
 * `openFromChart()` signs a throwaway clinician in to the EHR (password and second factor),
 * opens the app from `chartPatient`'s Apps tab and returns the app's tab, on its home page.
 * The clinician is removed afterwards. Every test in a file that uses these skips, with the
 * reason, when the local EHR stack is not running.
 */
import { test as base, type Page } from '@playwright/test'
import {
  createClinician,
  deleteClinician,
  launchFromChart,
  localEhrMissing,
  patientWithEncounters,
  signInWithSecondFactor,
  type ChartPatient,
  type Clinician,
} from './local-ehr'

export { expect } from '@playwright/test'

type EhrFixtures = {
  /** A synthetic patient of the clinic with several encounters. */
  chartPatient: ChartPatient
  /** The clinicians openFromChart() signed in during this test, in order. */
  clinicians: Clinician[]
  openFromChart: (patient?: ChartPatient) => Promise<Page>
}

let missing: Promise<string | null> | null = null

export const test = base.extend<EhrFixtures>({
  chartPatient: async ({}, use) => {
    missing ??= localEhrMissing()
    const reason = await missing
    base.skip(!!reason, `Needs the local Tiro EHR stack: ${reason}`)
    await use(await patientWithEncounters())
  },
  clinicians: async ({}, use) => {
    const clinicians: Clinician[] = []
    await use(clinicians)
    for (const clinician of clinicians) await deleteClinician(clinician)
  },
  openFromChart: async ({ page, chartPatient, clinicians }, use) => {
    await use(async (patient = chartPatient) => {
      const clinician = await createClinician()
      clinicians.push(clinician)
      await signInWithSecondFactor(page, clinician)
      const app = await launchFromChart(page, patient.id)
      await app.waitForURL(/^http:\/\/localhost:3001\/(\?.*)?$/, {
        timeout: 60_000,
      })
      return app
    })
  },
})
