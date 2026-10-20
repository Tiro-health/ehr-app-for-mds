import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // On tirohealth.app, Tiro's auth proxy answers the SMART sign-in paths of every app. Locally,
  // `pnpm dev` forwards them to a proxy you run yourself when TIRO_AUTH_URL is set (see
  // .env.example); without it the app runs as if it was not opened from the EHR.
  const authProxy = loadEnv(mode, process.cwd(), '').TIRO_AUTH_URL
  return {
    resolve: { tsconfigPaths: true },
    server: {
      port: 3001,
      strictPort: true,
      ...(authProxy
        ? {
            proxy: {
              '/_tiro': authProxy,
              '/.well-known/jwks.json': authProxy,
            },
          }
        : {}),
    },
    plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
