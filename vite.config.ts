import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * GitHub Pages serves a static 404.html for unknown paths. Copying index.html
 * to 404.html makes deep links (e.g. /patients/42) load the app, which then
 * routes client-side.
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(import.meta.dirname, 'dist')
      writeFileSync(
        resolve(outDir, '404.html'),
        readFileSync(resolve(outDir, 'index.html')),
      )
    },
  }
}

export default defineConfig({
  // The deploy workflow sets BASE_PATH to "/<repo-name>/" for GitHub Pages.
  base: process.env.BASE_PATH ?? '/',
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
    spaFallback(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
