import { useCallback, useEffect, useRef, useState } from 'react'
import type { Json, StoredState } from '@/lib/app-state'
import { appStateRead, appStateWrite } from '@/lib/app-state.functions'

/** Where the value is saved: in the EHR (SMART App State) or on this device. */
export type AppStateStatus = 'loading' | 'ehr' | 'device' | 'conflict' | 'error'

type Options<T> = {
  /** Checks a stored value and returns it, or undefined to use the initial value instead. */
  parse?: (value: unknown) => T | undefined
}

/**
 * Like useState, but saved, for the signed-in clinician. When the app was opened from the EHR
 * the value is stored there and follows the clinician to any device; otherwise it is kept in
 * this browser. Not for clinical data: that belongs in the patient's record.
 */
export function useAppState<T extends Json>(
  key: string,
  initial: T,
  options: Options<T> = {},
): [T, (next: T | ((prev: T) => T)) => void, AppStateStatus] {
  const [value, setValue] = useState<T>(initial)
  const [status, setStatus] = useState<AppStateStatus>('loading')
  const valueRef = useRef(value)
  const inEhr = useRef(false)
  const remote = useRef<StoredState | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const parseRef = useRef(options.parse)
  useEffect(() => {
    parseRef.current = options.parse
  })
  const parse = useCallback(
    (v: unknown) => (parseRef.current ? parseRef.current(v) : (v as T)),
    [],
  )

  useEffect(() => {
    let cancelled = false
    const adopt = (stored: unknown) => {
      const parsed = stored === undefined ? undefined : parse(stored)
      if (parsed !== undefined) {
        valueRef.current = parsed
        setValue(parsed)
      }
    }
    const fallBackToDevice = () => {
      inEhr.current = false
      adopt(readDevice(key))
      setStatus('device')
    }
    appStateRead({ data: { system: window.location.origin, key } })
      .then((answer) => {
        if (cancelled) return
        if (!answer.launched) return fallBackToDevice()
        inEhr.current = true
        remote.current = answer.data
        adopt(answer.data?.value)
        setStatus('ehr')
      })
      .catch(() => {
        if (!cancelled) fallBackToDevice()
      })
    return () => {
      cancelled = true
    }
  }, [key, parse])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)(valueRef.current)
          : next
      valueRef.current = resolved
      setValue(resolved)
      // Saves run one after the other so each one is based on the version the previous one got.
      saving.current = saving.current.then(async () => {
        if (!inEhr.current) return writeDevice(key, resolved)
        try {
          const current = remote.current
            ? { id: remote.current.id, version: remote.current.version }
            : null
          const answer = await appStateWrite({
            data: {
              system: window.location.origin,
              key,
              value: resolved,
              current,
            },
          })
          if (!answer.launched) {
            setStatus('error')
            return
          }
          const result = answer.data
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
        } catch {
          // Not logged: an error from the EHR can carry ids.
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
