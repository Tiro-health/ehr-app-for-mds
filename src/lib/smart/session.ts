// Not a React hook, despite the name: it opens the encrypted session cookie.
import { useSession as openSession } from '@tanstack/react-start/server'
import type { Connection, PendingLaunch } from './launch'

type SmartSession = {
  pending?: PendingLaunch
  connection?: Connection
  /** Why the last launch failed, shown once on the home page. */
  launchError?: string
}

/**
 * The SMART sign-in lives in an encrypted, httpOnly cookie, so the server itself keeps no data.
 * SameSite=Lax: the EHR opens the app in a new tab, a top-level navigation that carries the
 * cookie, while another site's requests (forms, fetches) do not.
 */
export function smartSession(appUrl: string) {
  const password = process.env.SESSION_SECRET
  if (!password || password.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters.')
  }
  return openSession<SmartSession>({
    name: 'smart',
    password,
    maxAge: 60 * 60 * 12,
    cookie: {
      httpOnly: true,
      secure: appUrl.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
    },
  })
}
