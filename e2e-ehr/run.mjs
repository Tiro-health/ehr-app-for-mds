// The real sidecar and this app against the local EHR stack: see README.md in this folder.
//
//   pnpm test:ehr [--quick]   start, run the Playwright test, stop
//   pnpm ehr:up               start and leave running, to launch by hand in a browser
//   pnpm ehr:reload           rebuild the app and restart its container
//   pnpm ehr:down             stop the sidecar, the app and the EHR stack

import { execFileSync, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EHR = 'http://localhost:3001'
const SIDECAR = 'http://localhost:8080'
const DATABASE =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:15432/postgres'
const CLIENT = 'dev-sidecar-app'
// A synthetic clinician of the local stack's demo practice. The same one the test signs in.
const CLINICIAN = 'sidecar-clinician@test.local'
const CLINICIAN_PASSWORD = 'password123'
const compose = fileURLToPath(new URL('docker-compose.yml', import.meta.url))
const mode = ['up', 'reload', 'down'].find((m) => process.argv.includes(m))
const quick = process.argv.includes('--quick')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const answers = (url) =>
  fetch(url, { redirect: 'manual' }).then(
    (response) => response.status < 500,
    () => false,
  )

async function waitFor(url, what) {
  for (let i = 0; i < 90; i++) {
    if (await answers(url)) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  fail(`${what} did not start (${url}).`)
}

const repo = process.env.EHR_REPO
if (!repo || !existsSync(`${repo}/smart-sidecar/e2e/seed.sql`)) {
  fail(
    'Set EHR_REPO to a checkout of Tiro-health/ehr that contains smart-sidecar/.',
  )
}
const stack = `${repo}/smart-sidecar/e2e/stack.sh`

const run = (command, args, env = {}) => {
  const { status } = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  return status ?? 1
}

// A throwaway signing key for the sidecar container. It exists only in this process and in
// the container; its public half is registered with the local EHR.
const newKey = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  })

const docker = (args, key = '') =>
  run('docker', ['compose', '-f', compose, ...args], { SMART_PRIVATE_KEY: key })

async function start() {
  if (run('pnpm', ['build']) !== 0) fail('The app does not build.')
  if (docker(['up', '-d', '--build'], newKey()) !== 0)
    fail('The sidecar and app did not start.')
  await waitFor(`${SIDECAR}/.well-known/jwks.json`, 'The sidecar')
  await waitFor(`${SIDECAR}/not-launched`, 'The app behind the sidecar')
}

/** Registers the sidecar's client and the clinician with the EHR; returns a seeded patient's id. */
async function seed() {
  const jwks = await (await fetch(`${SIDECAR}/.well-known/jwks.json`)).text()
  const vars = {
    client: CLIENT,
    origin: SIDECAR,
    jwks,
    email: CLINICIAN,
    password: CLINICIAN_PASSWORD,
  }
  const seeded = execFileSync(
    'psql',
    [
      ...['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-qAt', DATABASE],
      ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]),
      ...['-f', `${repo}/smart-sidecar/e2e/seed.sql`],
    ],
    { encoding: 'utf8' },
  )
  return (
    /^patient=(.+)$/m.exec(seeded)?.[1] ?? fail('The seed named no patient.')
  )
}

if (mode === 'down') {
  docker(['down', '--timeout', '2'])
  process.exit(run('bash', [stack, 'down']))
}

if (mode === 'reload') {
  if (run('pnpm', ['build']) !== 0) fail('The app does not build.')
  process.exit(docker(['restart', '--timeout', '2', 'app']))
}

if (mode === 'up') {
  if (!(await answers(`${EHR}/api/smart/jwks`))) {
    if (run('bash', [stack, 'up']) !== 0)
      fail('The local EHR stack did not start.')
  }
  await start()
  const patient = await seed()
  console.log(`
  The EHR, the sidecar and the app are running.

  1. Sign in to the EHR:   ${EHR}/login
       e-mail              ${CLINICIAN}
       password            ${CLINICIAN_PASSWORD}
  2. Open a patient's Apps tab, such as
                           ${EHR}/patients/${patient}/apps
  3. Click "Openen" on "Dev sidecar app". The app opens at ${SIDECAR}/

  The switcher of test users in the EHR cannot launch an app: sign in as above.

  After a change to the app:  pnpm ehr:reload
  To stop everything:         pnpm ehr:down
`)
  process.exit(0)
}

if (!(await answers(`${EHR}/api/smart/jwks`))) {
  fail(`The local EHR stack is not up. Run: bash "${stack}" up`)
}
if (!mode && process.argv.slice(2).some((arg) => arg !== '--quick')) {
  fail('Unknown argument. Use: up, reload, down, or --quick with the test.')
}

let status
try {
  await start()
  status = run(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', 'e2e-ehr/playwright.config.ts'],
    { EHR_E2E_QUICK: quick ? '1' : '' },
  )
  if (status !== 0) {
    console.error('--- sidecar and app logs')
    docker(['logs', '--tail', '60', 'sidecar', 'app'])
  }
} finally {
  docker(['down', '--timeout', '2'])
}
process.exit(status)
