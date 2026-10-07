// Not a React hook, despite the name: it opens the encrypted session cookie.
import { useSession as openSession } from '@tanstack/react-start/server'
import type { Connection, PendingLaunch } from './launch'

type SmartSession = { pending?: PendingLaunch; connection?: Connection }

/**
 * The SMART sign-in lives in an encrypted, httpOnly cookie, so the server itself keeps no
 * data. SameSite=None lets the cookie survive an EHR that shows the app inside a frame.
 */
export function smartSession() {
  const password = process.env.SESSION_SECRET
  if (!password || password.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters.')
  }
  return openSession<SmartSession>({
    name: 'smart',
    password,
    maxAge: 60 * 60 * 12,
    cookie: { httpOnly: true, secure: true, sameSite: 'none', path: '/' },
  })
}
