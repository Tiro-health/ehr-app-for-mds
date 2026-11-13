import { defineConfig, devices } from '@playwright/test'

// Browser test of the built app behind the pretend EHR: `pnpm test:e2e`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  reporter: 'list',
  use: { baseURL: 'http://localhost:3101' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:3101/not-launched',
    reuseExistingServer: false,
  },
})
