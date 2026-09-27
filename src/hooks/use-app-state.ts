import { useCallback, useEffect, useRef, useState } from 'react'
import { loadAppState, saveAppState } from '@/lib/app-state.functions'
import type { Json, StoredState } from '@/lib/smart/app-state'

/** Where the value is saved: in the EHR (SMART App State) or on this device. */
export type AppStateStatus = 'loading' | 'ehr' | 'device' | 'conflict' | 'error'

type Options<T> = {
  /** Checks a stored value and returns it, or undefined to use the initial value instead. */
  parse?: (value: unknown) => T | undefined
}

/**
 * Like useState, but saved. When the app was opened from the EHR the value is stored there,
 * for the signed-in clinician; otherwise it is kept in this browser.
 */
export function useAppState<T extends Json>(
  key: string,
  initial: T,
  options: Options<T> = {},
): [T, (next: T | ((prev: T) => T)) => void, AppStateStatus] {
  const [value, setValue] = useState<T>(initial)
  const [status, setStatus] = useState<AppStateStatus>('loading')
  const valueRef = useRef(value)
  const remote = useRef<StoredState | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const mode = useRef<'ehr' | 'device' | null>(null)
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
    loadAppState({ data: { key } })
      .then((res) => {
        if (cancelled) return
        if (res.connected) {
          remote.current = res.state
          mode.current = 'ehr'
          adopt(res.state?.value)
          setStatus('ehr')
        } else {
          mode.current = 'device'
          adopt(readDevice(key))
          setStatus('device')
        }
      })
      .catch(() => {
        if (cancelled) return
        mode.current = 'device'
        adopt(readDevice(key))
        setStatus('device')
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
      // Saves run one after the other so each PUT carries the version the previous one got.
      saving.current = saving.current.then(async () => {
        if (mode.current === 'device') return writeDevice(key, resolved)
        if (mode.current !== 'ehr') return
        try {
          const current = remote.current
            ? { id: remote.current.id, version: remote.current.version }
            : null
          const res = await saveAppState({
            data: { key, value: resolved, current },
          })
          if (!res.connected) {
            mode.current = 'device'
            writeDevice(key, resolved)
            setStatus('device')
          } else if (res.result.status === 'saved') {
            remote.current = res.result.state
            setStatus('ehr')
          } else {
            // Someone else saved first (another tab or device): show their value.
            remote.current = res.result.state
            const theirs = res.result.state?.value
            const parsed = theirs === undefined ? undefined : parse(theirs)
            if (parsed !== undefined) {
              valueRef.current = parsed
              setValue(parsed)
            }
            setStatus('conflict')
          }
        } catch {
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
