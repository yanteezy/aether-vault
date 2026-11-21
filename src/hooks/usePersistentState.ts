import { useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'aethel-vault:'

/** Set while a backup is being imported: the app reloads right after, and no old state may be written back. */
let suspended = false
export function suspendPersistence() {
  suspended = true
}

/**
 * Generic persisted-state hook. Any future tab, panel or setting should
 * store its state through this hook (new unique key) so it is remembered
 * across launches without extra plumbing per feature.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = STORAGE_PREFIX + key
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw !== null ? (JSON.parse(raw) as T) : initial
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch {
      return initial
    }
  })

  const first = useRef(true)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const write = () => {
      if (suspended) return
      try {
        localStorage.setItem(storageKey, JSON.stringify(latest.current))
      } catch {
        /* storage unavailable, ignore */
      }
    }
    const t = window.setTimeout(() => {
      pending.current = null
      write()
    }, 200)
    window.addEventListener('beforeunload', write)
    pending.current = write
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('beforeunload', write)
    }
  }, [value, storageKey])

  // flush a pending write when the owner unmounts (e.g. a vault tab is closed)
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => () => pending.current?.(), [])

  return [value, setValue] as const
}
