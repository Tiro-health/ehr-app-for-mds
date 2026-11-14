import { defineConfig, devices } from '@playwright/test'

// The built app behind the real sidecar, against the local EHR stack: `pnpm test:ehr`.
export default defineConfig({
  testDir: '.',
  testMatch: '*.ehr.ts',
  reporter: 'list',
  workers: 1,
  timeout: 8 * 60_000,
  use: { baseURL: 'http://localhost:8080' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
