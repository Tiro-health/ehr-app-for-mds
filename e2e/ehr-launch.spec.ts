import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import {
  FACADE_URL,
  createClinician,
  deleteClinician,
  discovery,
  grantOf,
  launchFromChart,
  localEhrMissing,
  patientWithEncounters,
  signInWithSecondFactor,
} from './support/local-ehr'
import type { ChartPatient, Clinician } from './support/local-ehr'

// A clinician opens the app from a patient's chart in the local Tiro EHR: real sign-in, real
// second factor, real private_key_jwt, and the app reading the patient from the EHR's FHIR API.
test.describe('opened from the EHR', () => {
  let clinician: Clinician | null = null
  let patient: ChartPatient

  test.beforeAll(async () => {
    const missing = await localEhrMissing()
    test.skip(!!missing, `Needs the local Tiro EHR stack: ${missing}`)
    patient = await patientWithEncounters()
  })

  test.afterEach(async () => {
    if (clinician) await deleteClinician(clinician)
    clinician = null
  })

  async function openFromChart(page: Page) {
    clinician = await createClinician()
    await signInWithSecondFactor(page, clinician)
    const app = await launchFromChart(page, patient.id)
    await app.waitForURL('http://localhost:3001/', { timeout: 60_000 })
    return app
  }

  /** Records which access token each request to the EHR's FHIR API carried. */
  function fhirTokens(app: Page) {
    const tokens: string[] = []
    app.on('request', (req: Request) => {
      if (!req.url().startsWith(FACADE_URL)) return
      const auth = req.headers()['authorization']
      if (auth) tokens.push(auth.replace(/^Bearer /, ''))
    })
    return tokens
  }

  test('the app shows the patient it was opened for, read straight from the EHR', async ({
    page,
  }) => {
    const app = await openFromChart(page)
    const patientRead = app.waitForRequest(
      (req) =>
        req.url().startsWith(FACADE_URL) && /\/Patient\//.test(req.url()),
    )
    await app.reload()
    const read = await patientRead
    // The browser calls the EHR itself with the access token; the app's server is not in between.
    expect(read.url()).toContain(`/fhir/R4/Patient/${patient.id}`)
    expect(read.headers()['authorization']).toMatch(/^Bearer \S+/)
    await expect(app.getByTestId('patient-name')).toContainText(patient.family)
    await expect(app.getByTestId('patient-name')).toContainText(patient.given)
  })

  test('the app survives token refreshes: the EHR refuses a token, the app gets a new one', async ({
    page,
  }) => {
    const app = await openFromChart(page)
    await expect(app.getByTestId('patient-name')).toContainText(patient.family)
    const tokens = fhirTokens(app)

    // Twice, so the second refresh has to use the rotated refresh token: reusing the first
    // would make the EHR revoke the whole sign-in.
    for (let round = 1; round <= 2; round++) {
      await app.route(
        `${FACADE_URL}/**/Patient/**`,
        (route) => route.fulfill({ status: 401, body: '' }),
        { times: 1 },
      )
      await app.reload()
      await expect(app.getByTestId('patient-name')).toContainText(
        patient.family,
      )
    }
    const distinct = [...new Set(tokens)]
    expect(distinct.length, 'one token per refresh, plus the first').toBe(3)
    // The EHR rotated the refresh token twice and the sign-in is still live.
    expect(await grantOf(clinician!)).toMatchObject({
      revoked: false,
      refreshes: 2,
    })
  })

  test('App State is saved in the EHR for the clinician', async ({ page }) => {
    const { capabilities } = await discovery()
    test.skip(
      !capabilities.includes('smart-app-state') ||
        !capabilities.includes('sso-openid-connect'),
      'The EHR does not advertise smart-app-state and sso-openid-connect yet (Tiro-health/ehr#2761, #2763).',
    )
    const app = await openFromChart(page)
    const click = () => app.getByRole('button', { name: 'Click me' }).click()
    await expect(app.getByText('Saved in the EHR')).toBeVisible()
    await click()
    await expect(app.getByText('Clicked 1 time')).toBeVisible()
    await expect(app.getByText('Saved in the EHR')).toBeVisible()

    // A fresh read with nothing on the device: the value comes back from the EHR.
    await app.evaluate(() => window.localStorage.clear())
    await app.reload()
    await expect(app.getByText('Clicked 1 time')).toBeVisible()
    await expect(app.getByText('Saved in the EHR')).toBeVisible()
    expect(
      await app.evaluate(() =>
        window.localStorage.getItem('app-state:click-count'),
      ),
    ).toBeNull()

    // A second tab saves first; this tab's save then carries a stale version, and the app
    // shows the newer value instead of overwriting it.
    const other = await app.context().newPage()
    await other.goto('http://localhost:3001/')
    await expect(other.getByText('Clicked 1 time')).toBeVisible()
    await other.getByRole('button', { name: 'Click me' }).click()
    await expect(other.getByText('Clicked 2 times')).toBeVisible()
    await other.getByRole('button', { name: 'Click me' }).click()
    await expect(other.getByText('Clicked 3 times')).toBeVisible()
    await expect(other.getByText('Saved in the EHR')).toBeVisible()

    await click()
    await expect(
      app.getByText('Updated elsewhere: showing the latest'),
    ).toBeVisible()
    await expect(app.getByText('Clicked 3 times')).toBeVisible()
  })
})
