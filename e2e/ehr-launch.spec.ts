import type { Page, Request } from '@playwright/test'
import { expect, test } from './support/ehr-test'
import { FACADE_URL, discovery, grantOf } from './support/local-ehr'

// A clinician opens the app from a patient's chart in the local Tiro EHR: real sign-in, real
// second factor, real private_key_jwt, and the app reading the patient from the EHR's FHIR API.
test.describe('opened from the EHR', () => {
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

  test('the app shows the patient it was opened for and their encounters, read straight from the EHR', async ({
    openFromChart,
    chartPatient: patient,
  }) => {
    const app = await openFromChart()
    const patientRead = app.waitForRequest(
      (req) =>
        req.url().startsWith(FACADE_URL) && /\/Patient\//.test(req.url()),
    )
    await app.reload()
    const read = await patientRead
    // The browser calls the EHR itself with the access token; the app's server is not in between.
    expect(read.url()).toContain(`/fhir/R4/Patient/${patient.id}`)
    expect(read.headers()['authorization']).toMatch(/^Bearer \S+/)

    await expect(app.getByTestId('patient-name')).toHaveText(
      `${patient.given} ${patient.family}`,
    )
    const [y, m, d] = patient.birthDate.split('-').map(Number)
    const born = `${d} ${new Date(Date.UTC(y, m - 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${y}`
    await expect(app.getByTestId('patient-details')).toContainText(
      `Born ${born}`,
    )
    await expect(app.getByTestId('patient-details')).toContainText(
      patient.gender === 'male' ? 'Male' : 'Female',
    )

    // The encounter list matches the EHR's own records for this patient.
    await expect(
      app.getByText(`${patient.encounters} in the EHR, most recent first`),
    ).toBeVisible()
    const rows = app
      .getByRole('list', { name: 'Encounters' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(Math.min(5, patient.encounters))
    const [ly, lm, ld] = patient.latestEncounter.split('-').map(Number)
    await expect(rows.first()).toContainText(
      `${ld} ${new Date(Date.UTC(ly, lm - 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${ly}`,
    )
  })

  test('the clinician’s setting is kept: on this device until the EHR offers App State', async ({
    openFromChart,
    chartPatient: patient,
  }) => {
    const { capabilities } = await discovery()
    const inEhr =
      capabilities.includes('smart-app-state') &&
      capabilities.includes('sso-openid-connect')
    const app = await openFromChart()
    const rows = app
      .getByRole('list', { name: 'Encounters' })
      .getByRole('listitem')
    await expect(rows).toHaveCount(Math.min(5, patient.encounters))
    await app.getByRole('button', { name: 'All' }).click()
    await expect(rows).toHaveCount(patient.encounters)
    const where = inEhr ? 'Saved in the EHR for you' : 'Saved on this device'
    await expect(app.getByTestId('setting-saved')).toHaveText(where)
    await app.reload()
    await expect(rows).toHaveCount(patient.encounters)
    await expect(app.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('the app survives token refreshes: the EHR refuses a token, the app gets a new one', async ({
    openFromChart,
    chartPatient: patient,
    clinicians,
  }) => {
    const app = await openFromChart()
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
    expect(await grantOf(clinicians[0])).toMatchObject({
      revoked: false,
      refreshes: 2,
    })
  })

  test('App State is saved in the EHR for the clinician', async ({
    openFromChart,
  }) => {
    const { capabilities } = await discovery()
    test.skip(
      !capabilities.includes('smart-app-state') ||
        !capabilities.includes('sso-openid-connect'),
      'The EHR does not advertise smart-app-state and sso-openid-connect yet (Tiro-health/ehr#2761, #2763).',
    )
    const app = await openFromChart()
    const saved = app.getByTestId('setting-saved')
    const pressed = (name: string) =>
      expect(app.getByRole('button', { name })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    // Loaded from the EHR (and the page is live) before anything is clicked.
    await expect(saved).toHaveText('Saved in the EHR for you')
    await app.getByRole('button', { name: '10' }).click()
    await pressed('10')
    await expect(saved).toHaveText('Saved in the EHR for you')

    // A fresh read with nothing on the device: the setting comes back from the EHR.
    await app.evaluate(() => window.localStorage.clear())
    await app.reload()
    await pressed('10')
    await expect(saved).toHaveText('Saved in the EHR for you')
    expect(
      await app.evaluate(() =>
        window.localStorage.getItem('app-state:encounters-shown'),
      ),
    ).toBeNull()

    // Another tab saves first; this tab's save then carries a stale version, and the app
    // shows the newer setting instead of overwriting it.
    const other = await app.context().newPage()
    await other.goto('http://localhost:3001/')
    await expect(other.getByTestId('setting-saved')).toHaveText(
      'Saved in the EHR for you',
    )
    await expect(other.getByRole('button', { name: '10' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await other.getByRole('button', { name: 'All' }).click()
    await expect(other.getByTestId('setting-saved')).toHaveText(
      'Saved in the EHR for you',
    )

    await app.getByRole('button', { name: '5' }).click()
    await expect(saved).toHaveText('Changed elsewhere: showing the latest')
    await pressed('All')
  })
})
