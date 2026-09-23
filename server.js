// Runs the built app in production: serves the files in dist/client and renders
// every page on the server with dist/server/server.js. Start it with `pnpm start`.
import { serve } from 'srvx'
import { serveStatic } from 'srvx/static'
import app from './dist/server/server.js'

serve({
  port: Number(process.env.PORT ?? 3000),
  middleware: [serveStatic({ dir: 'dist/client' })],
  fetch: app.fetch,
})
