import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests in a real browser. `pnpm test:e2e` starts the app on port 3001 (or reuses
 * a running `pnpm dev`). Tests that need the local Tiro EHR stack skip themselves, with the
 * reason, when it is not running.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // One at a time: the EHR's sign-in service rate-limits parallel sign-ins.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
