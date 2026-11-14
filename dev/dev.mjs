// `pnpm dev`: the local preview.
//
// Starts the app and, beside it, a pretend EHR with an invented patient, so the app can be
// seen both ways:
//   http://localhost:3001   as opened from the EHR (with the invented patient)
//   http://127.0.0.1:3000   as opened directly (no patient)

import { spawn } from 'node:child_process'
import { startFakeSidecar } from './fake-sidecar.mjs'

const port = process.env.PORT ?? '3000'

const sidecar = await startFakeSidecar({
  appUrl: `http://127.0.0.1:${port}`,
  autoLaunch: true,
}).catch((error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'The preview is already running (port 3001 or 8081 is in use). Stop the other one first.'
      : error,
  )
  process.exit(1)
})

const vite = spawn(
  'pnpm',
  [
    'exec',
    'vite',
    'dev',
    '--host',
    '127.0.0.1',
    '--port',
    port,
    '--strictPort',
  ],
  { stdio: 'inherit' },
)

console.log(`
  Preview with a pretend patient (as opened from the EHR):  ${sidecar.publicUrl}
  Preview without a patient (as opened directly):           http://127.0.0.1:${port}
`)

const stop = () => vite.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
vite.on('exit', async (code) => {
  await sidecar.close()
  process.exit(code ?? 0)
})
