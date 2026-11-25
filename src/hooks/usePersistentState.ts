import { useEffect, useRef, useState } from 'react'
import { getItem, setItem } from '../features/store'

const STORAGE_PREFIX = 'aethel-vault:'

/** Set while a backup is being imported: the app reloads right after, and no old state may be written back. */
let suspended = false
export function suspendPersistence() {
  suspended = true
}
/** Also checked by the vault repositories (features/vaultRepo.ts). */
export const isPersistenceSuspended = () => suspended

/**
 * Generic persisted-state hook. Any future tab, panel or setting should
 * store its state through this hook (new unique key) so it is remembered
 * across launches without extra plumbing per feature.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = STORAGE_PREFIX + key
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = getItem(storageKey)
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
        setItem(storageKey, JSON.stringify(latest.current))
      } catch {
        /* reported by the store (save status banner) */
      }
    }
    const t = window.setTimeout(() => {
      pending.current = null
      write()
    }, 200)
    window.addEventListener('beforeunload', write)
    // closing the window / relaunching after an update / importing: hand the change over right away
    window.addEventListener('aether:flush', write)
    pending.current = write
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('beforeunload', write)
      window.removeEventListener('aether:flush', write)
    }
  }, [value, storageKey])

  // flush a pending write when the owner unmounts (e.g. a vault tab is closed)
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => () => pending.current?.(), [])

  return [value, setValue] as const
}
