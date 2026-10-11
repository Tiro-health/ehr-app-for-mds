import { createFileRoute } from '@tanstack/react-router'
import { publicJwk } from '@/lib/smart/keys'
import { readSettings } from '@/lib/smart/launch'

// The app's public key, for the EHR to check the app's sign-in (its registered jwks_uri).
export const Route = createFileRoute('/.well-known/jwks.json')({
  server: {
    handlers: {
      GET: () => {
        const settings = readSettings()
        const keys = settings ? [publicJwk(settings.privateJwk)] : []
        return Response.json(
          { keys },
          { headers: { 'Cache-Control': 'public, max-age=300' } },
        )
      },
    },
  },
})
