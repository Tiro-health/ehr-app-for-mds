import { useCallback, useEffect, useRef, useState } from 'react'
import { useSmart } from '@/hooks/use-smart'
import { readState, writeState } from '@/lib/smart/app-state'
import type { AppStateTarget, Json, StoredState } from '@/lib/smart/app-state'

/** Where the value is saved: in the EHR (SMART App State) or on this device. */
export type AppStateStatus = 'loading' | 'ehr' | 'device' | 'conflict' | 'error'

type Options<T> = {
  /** Checks a stored value and returns it, or undefined to use the initial value instead. */
  parse?: (value: unknown) => T | undefined
}

/**
 * Like useState, but saved, for the signed-in clinician. When the EHR offers SMART App State
 * the value is stored there and follows the clinician to any device; otherwise it is kept in
 * this browser. Not for clinical data: that belongs in the patient's record.
 */
export function useAppState<T extends Json>(
  key: string,
  initial: T,
  options: Options<T> = {},
): [T, (next: T | ((prev: T) => T)) => void, AppStateStatus] {
  const smart = useSmart()
  const [value, setValue] = useState<T>(initial)
  const [status, setStatus] = useState<AppStateStatus>('loading')
  const valueRef = useRef(value)
  const remote = useRef<StoredState | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const target = useRef<AppStateTarget | null>(null)
  const parseRef = useRef(options.parse)
  useEffect(() => {
    parseRef.current = options.parse
  })
  const parse = useCallback(
    (v: unknown) => (parseRef.current ? parseRef.current(v) : (v as T)),
    [],
  )

  useEffect(() => {
    if (smart.status === 'loading') return
    let cancelled = false
    const adopt = (stored: unknown) => {
      const parsed = stored === undefined ? undefined : parse(stored)
      if (parsed !== undefined) {
        valueRef.current = parsed
        setValue(parsed)
      }
    }
    const fallBackToDevice = () => {
      target.current = null
      adopt(readDevice(key))
      setStatus('device')
    }
    const client = smart.status === 'launched' ? smart.client : null
    if (!client?.appStateEndpoint || !client.fhirUser) {
      fallBackToDevice()
      return
    }
    target.current = {
      endpoint: client.appStateEndpoint,
      fetch: (url, init) => client.fetch(url, init),
      system: window.location.origin,
      subject: client.fhirUser,
    }
    readState(target.current, key)
      .then((state) => {
        if (cancelled) return
        remote.current = state
        adopt(state?.value)
        setStatus('ehr')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error(error)
        fallBackToDevice()
      })
    return () => {
      cancelled = true
    }
  }, [key, parse, smart])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)(valueRef.current)
          : next
      valueRef.current = resolved
      setValue(resolved)
      // Saves run one after the other so each PUT carries the version the previous one got.
      saving.current = saving.current.then(async () => {
        const ehr = target.current
        if (!ehr) return writeDevice(key, resolved)
        try {
          const current = remote.current
            ? { id: remote.current.id, version: remote.current.version }
            : null
          const result = await writeState(ehr, key, resolved, current)
          remote.current = result.state
          if (result.status === 'saved') {
            setStatus('ehr')
            return
          }
          // Someone else saved first (another tab or device): show their value.
          const theirs = result.state?.value
          const parsed = theirs === undefined ? undefined : parse(theirs)
          if (parsed !== undefined) {
            valueRef.current = parsed
            setValue(parsed)
          }
          setStatus('conflict')
        } catch (error) {
          console.error(error)
          setStatus('error')
        }
      })
    },
    [key, parse],
  )

  return [value, update, status]
}

const PREFIX = 'app-state:'

function readDevice(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? undefined : (JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

function writeDevice(key: string, value: Json) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be full or blocked; the value still lives in the page for now.
  }
}
