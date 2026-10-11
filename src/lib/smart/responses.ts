import { LaunchError } from './launch'
import type { smartSession } from './session'

type Session = Awaited<ReturnType<typeof smartSession>>

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

/**
 * Ends a failed launch on the home page, which shows the reason. Launch problems the clinician
 * can act on keep their message; anything unexpected is logged and summarised.
 */
export async function launchFailed(session: Session, error: unknown) {
  let message: string
  if (typeof error === 'string') message = error
  else if (error instanceof LaunchError) message = error.message
  else {
    console.error('SMART launch failed', error)
    message = 'Opening the app from the EHR failed. Try again from the EHR.'
  }
  await session.update({
    pending: undefined,
    connection: undefined,
    launchError: message,
  })
  return redirect('/')
}
