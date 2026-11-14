import { expect, test } from '@playwright/test'

// The app as built for production, behind the pretend EHR with its invented patient.

test('opened from the EHR, it shows the patient and their encounters', async ({
  page,
}) => {
  await page.goto('/launch')

  await expect(page).toHaveURL('/')
  await expect(page.getByText('Jeanne Voorbeeld')).toBeVisible()
  const encounters = page.getByRole('list', { name: 'Encounters' })
  await expect(encounters.getByRole('listitem')).toHaveText([
    /First consultation.*14 Nov 2026.*in-progress/,
    /Day admission.*17 Jun 2026.*finished/,
    /Follow-up consultation.*3 Mar 2026.*finished/,
  ])

  // The page still works as a page: it took over in the browser.
  await page.getByRole('button', { name: 'Click me' }).click()
  await expect(page.getByText('Clicked 1 time')).toBeVisible()
})

test('the patient arrives in the first response, and no credential reaches the page', async ({
  page,
  request,
}) => {
  await page.goto('/launch')
  const cookies = await page.context().cookies()
  const session = cookies.find((cookie) => cookie.name === '__Host-smart')
  expect(session?.httpOnly).toBe(true)

  const html = await (await page.request.get('/')).text()
  expect(html).toContain('Jeanne Voorbeeld')
  expect(html).not.toContain(session!.value)

  // Another visitor, without a launch, gets the same page without the patient.
  const other = await (await request.get('/')).text()
  expect(other).not.toContain('Voorbeeld')
})

test('opened directly, it works as before, without a patient', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Click me' }).click()
  await expect(page.getByText('Clicked 1 time')).toBeVisible()
  await expect(page.getByText('Opened from the EHR')).toHaveCount(0)
})

test('a refused launch lands on the explanation', async ({ page }) => {
  await page.goto('/launch?fail=ehr-refused')

  await expect(page).toHaveURL('/not-launched?reason=ehr-refused')
  await expect(
    page.getByRole('heading', {
      name: 'The EHR did not allow the app to open',
    }),
  ).toBeVisible()
})

test('a request from another site that changes something is refused', async ({
  request,
}) => {
  const answer = await request.post('/', {
    headers: { origin: 'https://elsewhere.example' },
  })
  expect(answer.status()).toBe(403)
})
