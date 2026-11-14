// Runs the built app (`pnpm build`) behind the pretend EHR, for the browser test.
// Uses its own ports so it does not collide with a running `pnpm dev`.

import { spawn } from 'node:child_process'
import { startFakeSidecar } from '../dev/fake-sidecar.mjs'

const APP_PORT = '3100'

const sidecar = await startFakeSidecar({
  publicPort: 3101,
  apiPort: 8181,
  appUrl: `http://127.0.0.1:${APP_PORT}`,
})

const app = spawn('node', ['.output/server/index.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: APP_PORT,
    HOST: '127.0.0.1',
    EHR_SIDECAR_URL: sidecar.apiUrl,
  },
})

const stop = () => app.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
app.on('exit', async (code) => {
  await sidecar.close()
  process.exit(code ?? 0)
})
