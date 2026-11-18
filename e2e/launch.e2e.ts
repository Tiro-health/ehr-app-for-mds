import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

// The app as built for production, against the local EHR of compose.yaml: the sidecar in dev
// mode and fhir-candle with the fixtures. Start it first with `docker compose up`.
// Each test picks a debug scenario on the sidecar; the last one puts `patient` back.

const DEV_PAGE = process.env.SIDECAR_DEV_URL ?? 'http://localhost:8080'

async function scenario(request: APIRequestContext, name: string) {
  const answer = await request
    .post(`${DEV_PAGE}/_dev`, {
      headers: { origin: DEV_PAGE },
      form: { scenario: name },
      maxRedirects: 0,
    })
    .catch(() => undefined)
  expect(
    answer && answer.status() < 400,
    'The local EHR is not running: start it with `docker compose up`.',
  ).toBe(true)
}

test.describe.configure({ mode: 'serial' })
test.afterAll(async ({ request }) => scenario(request, 'patient'))

test('opened for a patient, it shows the patient and their encounters', async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  await page.goto('/')

  await expect(page.getByText('Jeanne Voorbeeld')).toBeVisible()
  const encounters = page.getByRole('list', { name: 'Encounters' })
  await expect(encounters.getByRole('listitem')).toHaveCount(3)

  // The page still works as a page: it took over in the browser.
  await expect(page.getByRole('button', { name: 'Click me' })).toBeEnabled()
})

test('the patient arrives in the first response', async ({ request }) => {
  await scenario(request, 'patient')
  const html = await (await request.get('/')).text()
  expect(html).toContain('Jeanne Voorbeeld')
})

test('the click count is saved in the EHR for the clinician', async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  await page.goto('/')
  await expect(page.getByText('Saved in the EHR')).toBeVisible()
  const count = page.getByText(/^Clicked \d+ times?$/)
  const before = Number((await count.textContent())?.match(/\d+/)?.[0])

  await page.getByRole('button', { name: 'Click me' }).click()
  await expect(count).toHaveText(new RegExp(`Clicked ${before + 1} `))
  await expect(page.getByText('Saved in the EHR')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Saved in the EHR')).toBeVisible()
  await expect(count).toHaveText(new RegExp(`Clicked ${before + 1} `))
})

test('without a patient, it shows no patient', async ({ page, request }) => {
  await scenario(request, 'no-patient')
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Opened from the EHR')).toHaveCount(0)
})

test('a refused scope names what is missing', async ({ page, request }) => {
  await scenario(request, 'scope-denied')
  await page.goto('/')

  await expect(page.getByText('Jeanne Voorbeeld')).toBeVisible()
  await expect(page.getByText(/patient\/Encounter\.rs/)).toBeVisible()
})

test('opened directly, the home page is open to anyone', async ({
  page,
  request,
}) => {
  await scenario(request, 'expired')
  await page.goto('/')

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Click me' })).toBeEnabled()
  await expect(page.getByText('Opened from the EHR')).toHaveCount(0)
})

test('the explanation page explains a refused launch', async ({ page }) => {
  await page.goto('/not-launched?reason=ehr-refused')
  await expect(
    page.getByRole('heading', {
      name: 'The EHR did not allow the app to open',
    }),
  ).toBeVisible()
})
