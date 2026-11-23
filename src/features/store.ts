/**
 * Where Aether keeps its data.
 *
 * Desktop app: every key is a small file in the data folder (Settings → General → Data folder). The default is the
 * system app-data folder (survives updates and reinstalls); the user can pick their own, e.g. Documents\Aether or
 * a Dropbox / OneDrive / iCloud folder. All files are read once at launch into memory, so reads stay synchronous;
 * writes go to disk right after (coalesced per key) and a failed write is reported, never swallowed.
 *
 * Browser (simulator / web build): the same API over localStorage.
 *
 * Only keys with the app prefix (`aethel-vault:`) live in the data folder; tiny cosmetic flags (splash) stay in
 * the webview's own storage.
 */
import { invoke } from '@tauri-apps/api/core'

export const P = 'aethel-vault:'
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let mem: Map<string, string> | null = null
/** Set while switching folders: nothing from the old session may be written into the new folder. */
let frozen = false
let dir = ''
let custom = false

// ---------- save status ----------
export type SaveStatus = { state: 'ok' } | { state: 'error'; reason: 'full' | 'folder' | 'other'; detail?: string }
let status: SaveStatus = { state: 'ok' }
const listeners = new Set<(s: SaveStatus) => void>()
export const saveStatus = () => status
export function onSaveStatus(fn: (s: SaveStatus) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
function setStatus(s: SaveStatus) {
  if (s.state === status.state && (s.state === 'ok' || (status.state === 'error' && s.reason === status.reason))) return
  status = s
  listeners.forEach((fn) => fn(s))
}
function reasonOf(e: unknown): SaveStatus {
  const text = String((e as Error)?.message ?? e)
  const name = (e as DOMException)?.name ?? ''
  if (/quota/i.test(name) || /quota|no space|disk full|ENOSPC|os error 28|os error 112/i.test(text)) return { state: 'error', reason: 'full', detail: text }
  if (/not found|os error 2\b|os error 3\b|permission|denied|os error 5\b|os error 13\b|missing-dir/i.test(text)) return { state: 'error', reason: 'folder', detail: text }
  return { state: 'error', reason: 'other', detail: text }
}

// ---------- sync API (same shape as localStorage) ----------
const onDisk = (k: string) => mem !== null && k.startsWith(P)

export function getItem(k: string): string | null {
  if (onDisk(k)) return mem!.get(k) ?? null
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
export function setItem(k: string, v: string) {
  if (onDisk(k)) {
    if (frozen || (mem!.get(k) === v && !queue.has(k))) return
    mem!.set(k, v)
    enqueue(k, v)
    return
  }
  try {
    localStorage.setItem(k, v)
    if (status.state === 'error' && !mem) setStatus({ state: 'ok' })
  } catch (e) {
    setStatus(reasonOf(e))
    throw e
  }
}
export function removeItem(k: string) {
  if (onDisk(k)) {
    if (frozen || !mem!.has(k)) return
    mem!.delete(k)
    enqueue(k, null)
    return
  }
  try {
    localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
/** Every stored key (with prefix). */
export function keys(): string[] {
  const out = new Set<string>()
  if (mem) mem.forEach((_, k) => out.add(k))
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (!mem || !k.startsWith(P)) out.add(k)
    }
  } catch {
    /* ignore */
  }
  return [...out]
}
/** JSON helpers for app keys (prefix added). */
export function readJson<T>(key: string): T | undefined {
  try {
    const raw = getItem(P + key)
    return raw == null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}
export const writeJson = (key: string, value: unknown) => setItem(P + key, JSON.stringify(value))

// ---------- disk queue ----------
const queue = new Map<string, string | null>()
let draining: Promise<void> | null = null
let retryTimer = 0
let retryDelay = 2000

function enqueue(k: string, v: string | null) {
  queue.set(k, v)
  if (!draining) draining = Promise.resolve().then(drain)
}
async function drain() {
  try {
    while (queue.size) {
      const [k, v] = queue.entries().next().value as [string, string | null]
      queue.delete(k)
      const key = k.slice(P.length)
      try {
        if (v === null) await invoke('data_remove', { key })
        else await invoke('data_write', { key, value: v })
      } catch (e) {
        // keep it (unless a newer value is already waiting) and try again a bit later
        if (!queue.has(k)) queue.set(k, v)
        setStatus(reasonOf(e))
        window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(() => {
          if (!draining && queue.size) draining = Promise.resolve().then(drain)
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30000)
        return
      }
    }
    retryDelay = 2000
    setStatus({ state: 'ok' })
  } finally {
    draining = null
  }
}

/** Ask every open editor to hand over its pending changes, then wait until all of them are on disk. */
export async function flush(): Promise<boolean> {
  window.dispatchEvent(new Event('aether:flush'))
  if (!mem) return status.state === 'ok'
  for (let i = 0; i < 3 && (queue.size || draining); i++) {
    if (!draining && queue.size) draining = Promise.resolve().then(drain)
    await draining
  }
  return queue.size === 0
}
/** Try the failed writes again now. */
export function retrySaving() {
  window.clearTimeout(retryTimer)
  retryDelay = 2000
  if (!draining && queue.size) draining = Promise.resolve().then(drain)
}

// ---------- the data folder ----------
interface Loaded {
  dir: string
  custom: boolean
  fresh: boolean
  entries: Record<string, string>
}
export const dataDir = () => ({ dir, custom })

/**
 * Load everything before the app renders. On the first launch of a version with the data folder, the notes in the
 * webview's storage (and the photos in IndexedDB) are copied into it; the originals are left in place.
 */
export async function initStore(): Promise<void> {
  if (!isDesktop()) return
  const r = await invoke<Loaded>('data_load')
  dir = r.dir
  custom = r.custom
  const m = new Map<string, string>()
  for (const [k, v] of Object.entries(r.entries)) m.set(P + k, v)
  if (r.fresh) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!
        if (k.startsWith(P) && !m.has(k)) {
          const v = localStorage.getItem(k)
          if (v != null) {
            m.set(k, v)
            queue.set(k, v)
          }
        }
      }
    } catch {
      /* nothing to bring over */
    }
  }
  mem = m
  if (r.fresh) {
    if (queue.size) {
      draining = Promise.resolve().then(drain)
      await draining
    }
    const { migrateImagesToFolder } = await import('./images')
    await migrateImagesToFolder().catch(() => {})
    if (queue.size === 0) await invoke('data_ready').catch(() => {})
  }
}

export interface FolderInfo {
  /** The folder the data would actually live in (a new "Aether" subfolder unless the chosen one is empty / ours). */
  target: string
  hasData: boolean
  notes: number
}
/** Native folder picker. null = cancelled. */
export const pickFolder = () => invoke<string | null>('data_pick_dir')
export const inspectFolder = (path: string) => invoke<FolderInfo>('data_inspect_dir', { path })
export const defaultFolder = () => invoke<string>('data_default_dir')
/**
 * Switch to another data folder. adopt = open the data that is already there (another computer's, via Dropbox…);
 * otherwise the current data is copied into it. The old folder is left as it was. The app reloads afterwards.
 */
export async function moveToFolder(path: string, adopt: boolean) {
  await flush()
  frozen = true
  try {
    await invoke<string>('data_set_dir', { path, adopt })
  } catch (e) {
    frozen = false
    throw e
  }
  window.location.reload()
}
