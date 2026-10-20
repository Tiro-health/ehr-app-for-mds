import { createFileRoute } from '@tanstack/react-router'
// Brings in the `server` route option.
import type {} from '@tanstack/react-start'
import { appConfig } from '@/app.config'

// Tells Tiro's auth proxy which EHR data this app asks for when it is opened from a patient's
// chart (the SMART scopes in app.config.ts). The proxy reads it at every launch.
export const Route = createFileRoute('/.well-known/tiro-app.json')({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { smart: { scopes: appConfig.ehr.scopes } },
          { headers: { 'Cache-Control': 'no-store' } },
        ),
    },
  },
})
