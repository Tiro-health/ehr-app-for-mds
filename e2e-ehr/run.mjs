// `pnpm test:ehr [--quick]`: see README.md in this folder.

import { execFileSync, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EHR = 'http://localhost:3001'
const SIDECAR = 'http://localhost:8080'
const compose = fileURLToPath(new URL('docker-compose.yml', import.meta.url))
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
if (!(await answers(`${EHR}/api/smart/jwks`))) {
  fail(
    `The local EHR stack is not up. Run: bash "${repo}/smart-sidecar/e2e/stack.sh" up`,
  )
}

const run = (command, args, env = {}) => {
  const { status } = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  return status ?? 1
}

if (run('pnpm', ['build']) !== 0) fail('The app does not build.')

// A throwaway signing key for the sidecar container. It exists only in this process and in
// the container; the test registers its public half with the local EHR.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })

const docker = (...args) =>
  run('docker', ['compose', '-f', compose, ...args], { SMART_PRIVATE_KEY: pem })

let status
try {
  if (docker('up', '-d', '--build') !== 0)
    fail('The sidecar and app did not start.')
  await waitFor(`${SIDECAR}/.well-known/jwks.json`, 'The sidecar')
  await waitFor(`${SIDECAR}/not-launched`, 'The app behind the sidecar')
  status = run(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', 'e2e-ehr/playwright.config.ts'],
    { EHR_E2E_QUICK: quick ? '1' : '' },
  )
  if (status !== 0) {
    console.error('--- sidecar and app logs')
    execFileSync(
      'docker',
      ['compose', '-f', compose, 'logs', '--tail', '60', 'sidecar', 'app'],
      {
        stdio: 'inherit',
        env: { ...process.env, SMART_PRIVATE_KEY: '' },
      },
    )
  }
} finally {
  docker('down', '--timeout', '2')
}
process.exit(status)
