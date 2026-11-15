import { defineConfig } from 'vitest/config'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const port = Number(process.env.PORT) || 3000

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Live reload connects to the app directly, also when the page is viewed through the
  // pretend EHR on another port (which, like the real one, passes no WebSocket on).
  server: { port, hmr: { clientPort: port } },
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    exclude: ['node_modules', '.output', 'e2e', 'e2e-ehr'],
  },
})
