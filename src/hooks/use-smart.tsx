import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getEhrConnection } from '@/lib/smart/connection.functions'
import { EhrClient } from '@/lib/smart/client'
import type { Connect } from '@/lib/smart/client'

/** Whether the app was opened from the EHR, and if so the client to read and write with. */
export type Smart =
  | { status: 'loading' }
  /** The deploy has no EHR settings. */
  | { status: 'not-configured' }
  /** Opened directly, not from a patient's chart. `error` says why a launch failed. */
  | { status: 'not-launched'; error?: string }
  /** The EHR ended the sign-in; open the app from the EHR again. */
  | { status: 'ended' }
  | { status: 'launched'; client: EhrClient }

const SmartContext = createContext<Smart | null>(null)

const connectToServer: Connect = (rejected) =>
  getEhrConnection({ data: { rejected } })

/**
 * Connects to the EHR once, in the browser, and shares the connection with every page.
 * `connect` is replaceable for tests.
 */
export function SmartProvider({
  children,
  connect = connectToServer,
}: {
  children: ReactNode
  connect?: Connect
}) {
  const [smart, setSmart] = useState<Smart>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    connect()
      .then((connection) => {
        if (cancelled) return
        if (connection.status !== 'launched') return setSmart(connection)
        const client = new EhrClient(connection, connect, () =>
          setSmart({ status: 'ended' }),
        )
        setSmart({ status: 'launched', client })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error(error)
        setSmart({
          status: 'not-launched',
          error: 'Could not reach this app’s server. Reload the page.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [connect])

  return <SmartContext value={smart}>{children}</SmartContext>
}

export function useSmart(): Smart {
  const smart = useContext(SmartContext)
  if (!smart) throw new Error('useSmart() needs a <SmartProvider> around it.')
  return smart
}
