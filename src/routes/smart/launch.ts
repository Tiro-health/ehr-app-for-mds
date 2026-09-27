import { createFileRoute } from '@tanstack/react-router'
import { LaunchError, readSettings, startLaunch } from '@/lib/smart/launch'
import { smartSession } from '@/lib/smart/session'

// The EHR opens /smart/launch?iss=...&launch=... to start a SMART launch.
export const Route = createFileRoute('/smart/launch')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const settings = readSettings()
        if (!settings)
          return text(503, 'This app is not set up for EHR launch.')
        const params = new URL(request.url).searchParams
        const iss = params.get('iss')
        if (!iss) return text(400, 'Missing iss: open this app from the EHR.')
        try {
          const { redirectTo, pending } = await startLaunch(settings, {
            iss,
            launch: params.get('launch') ?? undefined,
          })
          const session = await smartSession()
          await session.update({ pending, connection: undefined })
          return redirect(redirectTo)
        } catch (error) {
          return failure(error)
        }
      },
    },
  },
})

// Built by hand: Response.redirect() has read-only headers, so the session cookie could not
// be added to it.
export function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } })
}

export function text(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export function failure(error: unknown) {
  if (error instanceof LaunchError) return text(400, error.message)
  console.error(error)
  return text(
    502,
    error instanceof Error ? error.message : 'The EHR launch failed.',
  )
}
