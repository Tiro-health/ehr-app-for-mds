import { createFileRoute } from '@tanstack/react-router'
import { publicJwk } from '@/lib/smart/keys'
import { readSettings } from '@/lib/smart/launch'

// The app's public keys, for the EHR to check the app's sign-in (its registered jwks_uri).
// SMART_PUBLIC_JWKS, when set, is served as is, so a new key can be published before the app
// signs with it. The EHR caches this for max-age, which bounds how long a key rotation takes.
export const Route = createFileRoute('/.well-known/jwks.json')({
  server: {
    handlers: {
      GET: () => {
        const settings = readSettings()
        const jwks = settings
          ? (settings.publicJwks ?? { keys: [publicJwk(settings.privateJwk)] })
          : { keys: [] }
        return Response.json(jwks, {
          headers: { 'Cache-Control': 'public, max-age=300' },
        })
      },
    },
  },
})
