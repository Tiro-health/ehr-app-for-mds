/**
 * The local Tiro EHR stack, driven the way a clinician uses it: a real password sign-in, a real
 * second factor (TOTP), and the patient's Apps tab. Defaults match the EHR's
 * `scripts/local-stack.sh`; override with the E2E_* variables below.
 *
 * The clinician is a throwaway account created for each test and removed after it, so a failed
 * run never leaves a second factor on a shared login.
 */
import { createHmac } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'
import postgres from 'postgres'

export const EHR_URL = process.env.E2E_EHR_URL ?? 'http://localhost:3000'
export const GOTRUE_URL = process.env.E2E_GOTRUE_URL ?? 'http://localhost:9999'
export const FACADE_URL = process.env.E2E_FACADE_URL ?? 'http://localhost:8090'
export const DATABASE_URL =
  process.env.E2E_EHR_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:15432/postgres'
/** The clinic to launch in; the dev SMART app is approved in every clinic of the stack. */
export const CLINIC = process.env.E2E_EHR_CLINIC ?? 'dermato'
/** The dev SMART app's name as registered in the stack. */
export const APP_NAME = process.env.E2E_EHR_APP_NAME ?? 'Dev SMART app'

export const tenantBase = (slug = CLINIC) => `${FACADE_URL}/t/${slug}/fhir/R4`

/**
 * Why Tiro's auth proxy is not reachable through the app's dev server, or null when it is. It
 * does the SMART sign-in; run it locally and set TIRO_AUTH_URL (see .env.example).
 */
export async function authProxyMissing(): Promise<string | null> {
  try {
    const ping = await fetch('http://localhost:3001/_tiro/auth/ping')
    return ping.status === 204
      ? null
      : 'the auth proxy is not running (see .env.example)'
  } catch (error) {
    return `the app is not running (${String(error)})`
  }
}

/** Why the local EHR cannot be used, or null when it is up. */
export async function localEhrMissing(): Promise<string | null> {
  const proxy = await authProxyMissing()
  if (proxy) return proxy
  try {
    const discovery = await fetch(
      `${tenantBase()}/.well-known/smart-configuration`,
    )
    if (!discovery.ok) return `EHR discovery answered ${discovery.status}`
    const login = await fetch(`${EHR_URL}/login`)
    if (!login.ok) return `the EHR app answered ${login.status}`
    await withDb((sql) => sql`select 1`)
    return null
  } catch (error) {
    return `the local EHR stack is not running (${String(error)})`
  }
}

export async function discovery(): Promise<{ capabilities: string[] }> {
  const res = await fetch(`${tenantBase()}/.well-known/smart-configuration`)
  return (await res.json()) as { capabilities: string[] }
}

export async function withDb<T>(
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    return await fn(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export type Clinician = { id: string; email: string; password: string }

/** A staff account in the clinic, seeded the way the EHR's own e2e fixtures seed one. */
export async function createClinician(slug = CLINIC): Promise<Clinician> {
  const email = `template-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`
  const password = 'password123'
  const id = await withDb((sql) =>
    sql.begin(async (tx) => {
      const [org] = await tx<{ id: string }[]>`
        select id from public.org where slug = ${slug}`
      if (!org) throw new Error(`No clinic with slug ${slug}`)
      // GoTrue reads these timestamps and token strings as non-null: none may be NULL.
      const [user] = await tx<{ id: string }[]>`
        insert into auth.users (
          instance_id, aud, role, email, encrypted_password, email_confirmed_at,
          created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
          confirmation_token, recovery_token, email_change_token_new, email_change
        ) values (
          '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email},
          extensions.crypt(${password}, extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
        ) returning id`
      await tx`
        insert into auth.identities (
          id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
        ) values (
          gen_random_uuid(), ${user.id}, ${user.id}::text, 'email',
          jsonb_build_object('sub', ${user.id}::text, 'email', ${email}::text, 'email_verified', true),
          now(), now(), now()
        )`
      await tx`
        insert into public.profile (id, org_id, role, given, family)
        values (${user.id}, ${org.id}, 'surgeon', 'Template', 'Tester')`
      return user.id
    }),
  )
  return { id, email, password }
}

/**
 * Removes the clinician and what their launches left behind: the launch, the grant held by
 * "the app on behalf of this clinician", and the documents, encounters and App State the app
 * created on their behalf.
 */
export async function deleteClinician(clinician: Clinician) {
  await withDb((sql) =>
    sql.begin(async (tx) => {
      await tx`delete from smart.launch where auth_user_id = ${clinician.id}`
      const appActors = tx`
        select a.id from public.actor a
          join public.actor me on me.id = a.on_behalf_of_actor_id
         where me.practitioner_id = ${clinician.id}`
      const grants = tx`select id from smart.app_grant where actor_id in (${appActors})`
      await tx`delete from smart.refresh_token_history where grant_id in (${grants})`
      await tx`delete from smart.app_grant where actor_id in (${appActors})`
      await tx`delete from public.documents where created_by in (${appActors})`
      await tx`delete from public.encounters where created_by in (${appActors})`
      const [{ appState }] = await tx<{ appState: string | null }[]>`
        select to_regclass('public.smart_app_state')::text as "appState"`
      if (appState)
        await tx`delete from public.smart_app_state where created_by in (${appActors}) or updated_by in (${appActors})`
      await tx`delete from public.actor where id in (${appActors})`
      await tx`delete from public.profile where id = ${clinician.id}`
      await tx`delete from public.actor where practitioner_id = ${clinician.id}`
      await tx`delete from auth.users where id = ${clinician.id}`
    }),
  )
}

export type ChartPatient = {
  id: string
  given: string
  family: string
  birthDate: string
  gender: string
  encounters: number
  /** The most recent encounter's day, YYYY-MM-DD. */
  latestEncounter: string
}

/** A patient of the clinic with several encounters, so the app has something to show. */
export async function patientWithEncounters(
  slug = CLINIC,
): Promise<ChartPatient> {
  const [row] = await withDb(
    (sql) => sql<ChartPatient[]>`
      select p.id, p.given, p.family, p.birth_date::text as "birthDate", p.gender,
             count(e.id)::int as encounters, max(e.occurred_on)::date::text as "latestEncounter"
        from public.patients p
        join public.org o on o.id = p.org_id
        join public.encounters e on e.patient_id = p.id and e.deleted_at is null
       where o.slug = ${slug} and p.deleted_at is null and p.merged_into_id is null
       group by p.id
       order by count(e.id) desc, p.id
       limit 1`,
  )
  if (!row) throw new Error(`No patient with encounters in ${slug}`)
  return row
}

/**
 * Signs the clinician in to the EHR with their password, then enrols and verifies a TOTP second
 * factor (launching an app requires one), and puts that session in the browser.
 */
export async function signInWithSecondFactor(page: Page, clinician: Clinician) {
  const deadline = Date.now() + 60_000
  // Retried: the server-rendered form shows before it can submit.
  for (;;) {
    await page.goto(`${EHR_URL}/login`)
    await page.getByLabel('E-mailadres', { exact: true }).fill(clinician.email)
    await page
      .getByLabel('Wachtwoord', { exact: true })
      .fill(clinician.password)
    await page.getByRole('button', { name: 'Aanmelden', exact: true }).click()
    try {
      await page.waitForURL(/\/(dashboard|mfa-challenge)/, { timeout: 10_000 })
      break
    } catch (error) {
      if (Date.now() > deadline) throw error
    }
  }
  const cookie = await readSessionCookie(page.context())
  if (!cookie) throw new Error('The EHR sign-in left no session cookie.')
  const session = await enrollTotp(cookie.session.access_token)
  await writeSessionCookie(page.context(), cookie.name, session)
}

/** Opens the app from the patient's Apps tab; the EHR opens it in a new tab. */
export async function launchFromChart(page: Page, patientId: string) {
  await page.goto(`${EHR_URL}/patients/${patientId}/apps`)
  const opened = page.waitForEvent('popup')
  await page.getByRole('button', { name: `Openen ${APP_NAME}` }).click()
  return opened
}

// ── GoTrue: TOTP enrolment, as the EHR's own e2e suite does it ─────────────────────────────

type GoTrueSession = { access_token: string; [key: string]: unknown }

async function gotrue<T>(path: string, accessToken: string, body: unknown) {
  const res = await fetch(`${GOTRUE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`GoTrue ${path} answered ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

async function enrollTotp(accessToken: string): Promise<GoTrueSession> {
  const factor = await gotrue<{ id: string; totp: { secret: string } }>(
    '/factors',
    accessToken,
    { factor_type: 'totp', friendly_name: `template-e2e-${Date.now()}` },
  )
  const challenge = await gotrue<{ id: string }>(
    `/factors/${factor.id}/challenge`,
    accessToken,
    {},
  )
  return gotrue<GoTrueSession>(`/factors/${factor.id}/verify`, accessToken, {
    challenge_id: challenge.id,
    code: totpCode(factor.totp.secret),
  })
}

/** RFC 6238: an HMAC-SHA1 of the 30-second counter, truncated to six digits. */
function totpCode(secret: string, atMs = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, '0')
}

// ── The EHR's session cookie, read and written the way @supabase/ssr does ────────────────

const AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/
const CHUNK = 3180

async function readSessionCookie(context: BrowserContext) {
  const cookies = (await context.cookies(EHR_URL)).filter((c) =>
    AUTH_COOKIE.test(c.name),
  )
  if (!cookies.length) return null
  const name = cookies[0].name.replace(/\.\d+$/, '')
  const raw = cookies
    .filter((c) => c.name.replace(/\.\d+$/, '') === name)
    .sort(
      (a, b) =>
        Number(a.name.split('.')[1] ?? 0) - Number(b.name.split('.')[1] ?? 0),
    )
    .map((c) => decodeURIComponent(c.value))
    .join('')
  const json = raw.startsWith('base64-')
    ? Buffer.from(raw.slice(7), 'base64url').toString('utf8')
    : raw
  return { name, session: JSON.parse(json) as GoTrueSession }
}

async function writeSessionCookie(
  context: BrowserContext,
  name: string,
  session: GoTrueSession,
) {
  await context.clearCookies({ name: new RegExp(`^${name}(\\.\\d+)?$`) })
  const value =
    'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  const parts =
    value.length <= CHUNK
      ? [{ name, value }]
      : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => ({
          name: `${name}.${i}`,
          value: value.slice(i * CHUNK, (i + 1) * CHUNK),
        }))
  const { hostname } = new URL(EHR_URL)
  await context.addCookies(
    parts.map((part) => ({
      ...part,
      domain: hostname,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  )
}

/** The EHR's record of the clinician's grant: revoked or live, and how often it was refreshed. */
export async function grantOf(clinician: Clinician) {
  const [row] = await withDb(
    (sql) => sql<{ revoked: boolean; refreshes: number; scope: string }[]>`
      select g.revoked_at is not null as revoked, g.scope,
             (select count(*)::int from smart.refresh_token_history h where h.grant_id = g.id) as refreshes
        from smart.app_grant g
        join public.actor a on a.id = g.actor_id
        join public.actor me on me.id = a.on_behalf_of_actor_id
       where me.practitioner_id = ${clinician.id}
       order by g.issued_at desc
       limit 1`,
  )
  return row ?? null
}
