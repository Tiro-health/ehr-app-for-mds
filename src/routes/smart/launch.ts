import { createFileRoute } from '@tanstack/react-router'
import { readSettings, startLaunch } from '@/lib/smart/launch'
import { smartSession } from '@/lib/smart/session'
import { launchFailed, redirect, text } from '@/lib/smart/responses'

// The EHR opens /smart/launch?iss=...&launch=... to start a SMART launch. With only `iss` it is
// a standalone launch: the EHR asks who is signing in and which patient.
export const Route = createFileRoute('/smart/launch')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const settings = readSettings()
        if (!settings)
          return text(503, 'This app is not set up to open from the EHR.')
        const params = new URL(request.url).searchParams
        const iss = params.get('iss')
        if (!iss) return text(400, 'Missing iss: open this app from the EHR.')
        const session = await smartSession(settings.appUrl)
        try {
          const { redirectTo, pending } = await startLaunch(settings, {
            iss,
            launch: params.get('launch') ?? undefined,
          })
          await session.update({
            pending,
            connection: undefined,
            launchError: undefined,
          })
          return redirect(redirectTo)
        } catch (error) {
          return launchFailed(session, error)
        }
      },
    },
  },
})
