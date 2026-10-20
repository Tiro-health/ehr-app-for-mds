import { expect, test } from '@playwright/test'
import { authProxyMissing } from './support/local-ehr'

test('opened directly, the app says it was not opened from a patient’s chart', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(
    page.getByText('Not opened from a patient’s chart'),
  ).toBeVisible()
})

test('a launch from an EHR that is not allowed ends on the home page with the reason', async ({
  page,
}) => {
  const missing = await authProxyMissing()
  test.skip(missing !== null, missing ?? '')
  await page.goto('/_tiro/auth/launch?iss=https://evil.example.org/fhir')
  await expect(page).toHaveURL('/')
  await expect(
    page.getByText(
      'This app may not be launched from https://evil.example.org/fhir.',
    ),
  ).toBeVisible()
})

test('the app publishes its public key and nothing private', async ({
  request,
}) => {
  const missing = await authProxyMissing()
  test.skip(missing !== null, missing ?? '')
  const res = await request.get('/.well-known/jwks.json')
  expect(res.ok()).toBe(true)
  const { keys } = (await res.json()) as { keys: Record<string, unknown>[] }
  for (const key of keys) {
    expect(key).toMatchObject({ use: 'sig' })
    expect(key).not.toHaveProperty('d')
  }
})
