import { defineConfig } from 'vitest/config'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3001, strictPort: true },
  // The server plugins start a dev server inside Vitest that only logs errors; tests need neither.
  plugins: [
    tailwindcss(),
    ...(process.env.VITEST ? [] : [tanstackStart(), nitro()]),
    viteReact(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
