import { defineConfig, devices } from '@playwright/test'

// Browser test of the built app against the local EHR: `docker compose up`, then
// `pnpm test:e2e`. The app runs on its own port, so a running `pnpm dev` is not in the way.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node .output/server/index.mjs',
    env: { PORT: '3100', HOST: '127.0.0.1' },
    url: 'http://127.0.0.1:3100/not-launched',
    reuseExistingServer: false,
  },
})
