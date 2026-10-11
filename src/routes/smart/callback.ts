import { createFileRoute } from '@tanstack/react-router'
import { finishLaunch, readSettings } from '@/lib/smart/launch'
import { smartSession } from '@/lib/smart/session'
import { launchFailed, redirect, text } from '@/lib/smart/responses'

// The EHR's authorization server sends the clinician back here after sign-in.
export const Route = createFileRoute('/smart/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const settings = readSettings()
        if (!settings)
          return text(503, 'This app is not set up to open from the EHR.')
        const session = await smartSession(settings.appUrl)
        const pending = session.data.pending
        if (!pending) {
          return launchFailed(
            session,
            'No sign-in was in progress. Open the app from the EHR again.',
          )
        }
        const params = new URL(request.url).searchParams
        try {
          const connection = await finishLaunch(settings, pending, {
            code: params.get('code') ?? undefined,
            state: params.get('state') ?? undefined,
            error: params.get('error') ?? undefined,
            errorDescription: params.get('error_description') ?? undefined,
          })
          await session.update({ pending: undefined, connection })
          return redirect('/')
        } catch (error) {
          return launchFailed(session, error)
        }
      },
    },
  },
})
