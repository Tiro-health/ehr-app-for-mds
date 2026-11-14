import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The built app behind the real sidecar, launched from the local Tiro EHR. See README.md.
//
// The test plays the EHR's side: it registers the sidecar's client, signs a synthetic
// clinician in to the EHR with a second factor, and opens the app on a seeded patient the way
// the Apps tab does. From there on a real browser follows the launch. The app under test
// contains none of this.

const EHR = 'http://localhost:3001'
const GOTRUE = 'http://127.0.0.1:9999'
const EHR_SESSION_COOKIE = 'sb-127-auth-token'
const APP = 'http://localhost:8080'
const DATABASE =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:15432/postgres'
const CLIENT = 'dev-sidecar-app'
const CLINICIAN = 'sidecar-clinician@test.local'
const CLINICIAN_PASSWORD = 'password123'
const ACCESS_LIFETIME_MS = 300_000

const sql = (...args: string[]) =>
  execFileSync(
    'psql',
    ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-qAt', DATABASE, ...args],
    { encoding: 'utf8' },
  ).trim()

async function ehrAuth(path: string, body: object, session?: string) {
  const answer = await fetch(GOTRUE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!answer.ok) throw new Error(`EHR sign-in ${path}: ${answer.status}`)
  return answer.json()
}

/** The six-digit code of an authenticator app (RFC 6238). */
function authenticatorCode(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const bytes = bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, '0')
}

test.describe.configure({ mode: 'serial' })

let page: Page
let launchedAt = 0
let expected: { name: string; encounters: number }
let cleanUp = async () => {}

test.beforeAll(async ({ browser }) => {
  // Register the sidecar's client with the EHR, approve it for the demo practice, create the
  // synthetic clinician. The EHR repository's own seed does it; it names the patient.
  const jwks = await (await fetch(`${APP}/.well-known/jwks.json`)).text()
  const seeded = sql(
    ...['-v', `client=${CLIENT}`, '-v', `origin=${APP}`, '-v', `jwks=${jwks}`],
    ...['-v', `email=${CLINICIAN}`, '-v', `password=${CLINICIAN_PASSWORD}`],
    ...['-f', `${process.env.EHR_REPO}/smart-sidecar/e2e/seed.sql`],
  )
  const patientId = /^patient=(.+)$/m.exec(seeded)?.[1]
  expect(patientId, 'the seed names a patient').toBeTruthy()

  // What the EHR's own database says about that patient: the page must agree.
  const [name, encounters] = sql(
    '-c',
    `select given || ' ' || family || '|' ||
            (select count(*) from public.encounters e
              where e.patient_id = p.id and e.deleted_at is null)
       from public.patients p where p.id = '${patientId}'`,
  ).split('|')
  expected = { name: name!, encounters: Number(encounters) }

  // The clinician signs in to the EHR with a second factor.
  const first = await ehrAuth('/token?grant_type=password', {
    email: CLINICIAN,
    password: CLINICIAN_PASSWORD,
  })
  const factor = await ehrAuth(
    '/factors',
    { factor_type: 'totp', friendly_name: `template-e2e-${Date.now()}` },
    first.access_token,
  )
  const challenge = await ehrAuth(
    `/factors/${factor.id}/challenge`,
    {},
    first.access_token,
  )
  const ehrSession = await ehrAuth(
    `/factors/${factor.id}/verify`,
    { challenge_id: challenge.id, code: authenticatorCode(factor.totp.secret) },
    first.access_token,
  )
  cleanUp = async () => {
    await fetch(`${GOTRUE}/factors/${factor.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ehrSession.access_token}` },
    })
  }

  // The browser holds the EHR's session cookie, as after signing in to the EHR.
  const context = await browser.newContext()
  const value =
    'base64-' + Buffer.from(JSON.stringify(ehrSession)).toString('base64url')
  const chunks = value.match(/.{1,3180}/g)!
  await context.addCookies(
    chunks.map((chunk, i) => ({
      name:
        chunks.length > 1 ? `${EHR_SESSION_COOKIE}.${i}` : EHR_SESSION_COOKIE,
      value: chunk,
      url: EHR,
    })),
  )

  // Opening the app from the patient's Apps tab posts this form; the EHR answers with the
  // address of the app's launch.
  const opened = await context.request.post(`${EHR}/apps/launch`, {
    form: { clientId: CLIENT, patientId: patientId! },
    headers: { origin: EHR, 'sec-fetch-site': 'same-origin' },
    maxRedirects: 0,
  })
  expect(opened.status(), 'the EHR starts the launch').toBe(303)
  const launchUrl = opened.headers()['location']!
  expect(launchUrl.startsWith(`${APP}/launch?`)).toBe(true)

  page = await context.newPage()
  launchedAt = Date.now()
  await page.goto(launchUrl)
})

test.afterAll(async () => {
  await cleanUp()
  await page?.context().close()
})

test('launched from the EHR, the app shows the patient and their encounters', async () => {
  await expect(page).toHaveURL(`${APP}/`)
  await expect(page.getByText(expected.name)).toBeVisible()
  await expect(page.getByText('Opened from the EHR')).toBeVisible()

  const encounters = page.getByRole('list', { name: 'Encounters' })
  await expect(encounters.getByRole('listitem')).toHaveCount(
    expected.encounters,
  )

  // The page took over in the browser, and the browser holds nothing but the opaque cookie.
  await page.getByRole('button', { name: 'Click me' }).click()
  await expect(page.getByText('Clicked 1 time')).toBeVisible()
  const cookies = await page.context().cookies(APP)
  const session = cookies.find((cookie) => cookie.name === '__Host-smart')
  expect(session?.httpOnly).toBe(true)
  expect(await page.content()).not.toContain(session!.value)
})

test('a visitor who did not launch gets the app without the patient', async ({
  browser,
}) => {
  const other = await browser.newContext()
  const visitor = await other.newPage()
  await visitor.goto(`${APP}/`)
  await expect(visitor.getByRole('button', { name: 'Click me' })).toBeVisible()
  await expect(visitor.getByText('Opened from the EHR')).toHaveCount(0)
  await expect(visitor.getByText(expected.name)).toHaveCount(0)
  await other.close()
})

test('the session survives the end of its first access token', async () => {
  test.skip(!!process.env.EHR_E2E_QUICK, 'skipped by --quick')

  // The sidecar refreshes when under a minute remains. Load once inside that window, and
  // once after the first token has ended: only a refreshed one can still read the patient.
  for (const after of [
    ACCESS_LIFETIME_MS - 55_000,
    ACCESS_LIFETIME_MS + 10_000,
  ]) {
    await page.waitForTimeout(Math.max(0, launchedAt + after - Date.now()))
    await page.reload()
    await expect(page.getByText(expected.name)).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Encounters' }).getByRole('listitem'),
    ).toHaveCount(expected.encounters)
  }

  // The EHR's own record: this grant's refresh was used exactly once.
  const rotations = sql(
    '-c',
    `select count(*) from smart.refresh_token_history h
       join smart.app_grant g on g.id = h.grant_id
       join public.org_smart_client a on a.id = g.org_smart_client_id
      where a.client_id = '${CLIENT}' and g.revoked_at is null
        and g.issued_at > now() - interval '10 minutes'`,
  )
  expect(rotations).toBe('1')
})
