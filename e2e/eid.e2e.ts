import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

// The eID check as built for production, against the local EHR. There is no card reader here:
// the BeIDConnect extension is replaced in the browser by an object with the same interface
// (`window.EIDChromeExt`, see ChromeExtension/src_v3/main/page.js in Fedict/fts-beidconnect)
// that answers with an invented card from fixtures/eid/. The app's own code, including the
// signature check on the server, is the real one.

const DEV_PAGE = process.env.SIDECAR_DEV_URL ?? 'http://localhost:8080'
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`fixtures/eid/${name}.json`, 'utf8'))

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

/** Installs a stand-in for the BeIDConnect extension that resolves or rejects like page.js. */
async function fakeBeIdConnect(page: Page, answer: unknown) {
  await page.addInitScript((reply) => {
    const win = window as unknown as Record<string, unknown>
    win.EIDChromeExt = function (this: Record<string, unknown>) {
      this.getId = (language: string, mac: string, idflags: number) => {
        win.__eidRequest = { language, mac, idflags }
        const result = (reply as { result?: string }).result
        return result === 'OK' ? Promise.resolve(reply) : Promise.reject(reply)
      }
    }
  }, answer)
}

test.describe.configure({ mode: 'serial' })
test.afterAll(async ({ request }) => scenario(request, 'patient'))

test('a card of the same person matches the patient in the EHR', async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  await fakeBeIdConnect(page, fixture('card-matching-patient-1'))
  await page.goto('/eid')

  await expect(page.getByText('Jeanne Voorbeeld')).toBeVisible()
  await page.getByRole('button', { name: 'Read eID' }).click()

  const rows = page
    .getByRole('table', { name: 'Comparison' })
    .locator('tbody tr')
  await expect(rows).toHaveCount(5)
  await expect(page.locator('tbody tr[data-outcome="match"]')).toHaveCount(5)
  // The server checked the signatures, and the page does not claim more than that.
  await expect(
    page.getByText('Signatures valid, origin of the card not checked'),
  ).toBeVisible()
  await expect(page.getByText(/RSA SHA-256/)).toBeVisible()
  // Identity (1), address (2) and signatures (8); no photo.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __eidRequest: { idflags: number } })
          .__eidRequest.idflags,
    ),
  ).toBe(11)
})

test("someone else's card differs, and its test signatures are valid", async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  await fakeBeIdConnect(page, fixture('card-beidconnect-specimen'))
  await page.goto('/eid')
  await page.getByRole('button', { name: 'Read eID' }).click()

  await expect(page.locator('tbody tr[data-outcome="mismatch"]')).toHaveCount(4)
  await expect(page.getByText(/eID TEST RRN/)).toBeVisible()
  await expect(page.getByText('Specimenstraat 12, 0000 Utopia')).toBeVisible()
})

test('a card that was changed after signing is flagged', async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  const card = fixture('card-matching-patient-1') as {
    Readers: { addr: string }[]
  }
  const other = fixture('card-beidconnect-specimen') as {
    Readers: { addr: string }[]
  }
  card.Readers[0].addr = other.Readers[0].addr
  await fakeBeIdConnect(page, card)
  await page.goto('/eid')
  await page.getByRole('button', { name: 'Read eID' }).click()

  await expect(page.getByText('Signatures not valid')).toBeVisible()
  await expect(
    page.getByText('The signature on the address data is not valid.'),
  ).toBeVisible()
})

test('without the extension, the page says what to install', async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  await page.goto('/eid')
  await page.getByRole('button', { name: 'Read eID' }).click()

  await expect(
    page.getByText('BeIDConnect is not installed in this browser'),
  ).toBeVisible()
})

test('no card in the reader', async ({ page, request }) => {
  await scenario(request, 'patient')
  await fakeBeIdConnect(page, { result: 'no_card', Readers: [] })
  await page.goto('/eid')
  await page.getByRole('button', { name: 'Read eID' }).click()

  await expect(page.getByText('No eID card in the reader')).toBeVisible()
})

test('the simulated cards of the local preview are not in the published app', async ({
  page,
  request,
}) => {
  await scenario(request, 'patient')
  await page.goto('/eid')
  await expect(page.getByRole('button', { name: 'Read eID' })).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(1)
})

test('opened without a patient, the page is not shown', async ({
  page,
  request,
}) => {
  await scenario(request, 'no-patient')
  await page.goto('/eid')
  await expect(page).toHaveURL(/\/not-launched\?reason=no-patient/)
})

test('opened directly, the page is not shown', async ({ page, request }) => {
  await scenario(request, 'expired')
  await page.goto('/eid')
  await expect(page).toHaveURL(/\/not-launched\?reason=not-from-ehr/)
})

test('the server function refuses a visitor without a session', async ({
  page,
  request,
}) => {
  // Load the page with a session, then let the session end before reading the card.
  await scenario(request, 'patient')
  await fakeBeIdConnect(page, fixture('card-matching-patient-1'))
  await page.goto('/eid')
  await expect(page.getByText('Jeanne Voorbeeld')).toBeVisible()
  await scenario(request, 'expired')
  await page.getByRole('button', { name: 'Read eID' }).click()

  await expect(page.getByText('Your session has ended')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
})
