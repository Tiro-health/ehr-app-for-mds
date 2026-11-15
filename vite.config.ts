import { defineConfig } from 'vitest/config'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const port = Number(process.env.PORT) || 3000

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Live reload connects to the app directly, also when the page is viewed through the
  // sidecar on port 8080, which passes no WebSocket on. 127.0.0.1, not localhost (which can be
  // IPv6 only), so the sidecar in compose reaches it at host.docker.internal.
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    hmr: { clientPort: port },
  },
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
    exclude: ['node_modules', '.output', 'e2e'],
  },
})
