/**
 * Backup file (.aether): move notes, workspaces, themes and settings to another computer.
 *
 * The file is plain JSON with up to three sections the user picks:
 *  - notes    → every workspace (name, notes, connections, frames, buttons, drawings, view) + the photos they use
 *  - themes   → theme, accent, glass, card look, canvas background; and each workspace's own theme
 *  - settings → everything else from Settings (language, grid, fonts, hotkey…) and panel / tool state
 *
 * Import writes the chosen sections into storage and reloads the app. Workspaces from the file replace the ones
 * with the same id (the first workspace is always "default"), other workspaces on this computer stay.
 */
import pkg from '../../package.json'
import { suspendPersistence } from '../hooks/usePersistentState'
import { DEFAULT_VAULT_ID, deleteVaultData, vaultKey } from '../hooks/vaultKeys'
import type { AppSettings } from '../settings/settings'
import type { Vault } from '../types/note'
import { allIds, getImage, putImage } from './images'
import { flush, getItem, removeItem, setItem } from './store'

const P = 'aethel-vault:'
export const BACKUP_EXT = 'aether'
export type BackupSection = 'notes' | 'themes' | 'settings'
export const BACKUP_SECTIONS: BackupSection[] = ['notes', 'themes', 'settings']

/** Per-workspace data keys (see hooks/vaultKeys.ts). */
const VAULT_DATA = ['notes', 'connections', 'canvas-transform', 'ink', 'frames', 'chips'] as const
/** Settings that make up "the look". */
const THEME_KEYS = ['theme', 'accent', 'canvasBg', 'glassBlur', 'cardOpacity', 'cardRadius', 'compactCorners'] as const
/** App-wide UI state that travels with "settings". */
const UI_KEYS = ['view-mode', 'ink-tool', 'panel-graph', 'panel-tags', 'panel-vault', 'active-tag-filters'] as const

interface BackupVault {
  id: string
  name: string
  createdAt: number
  seed?: Vault['seed']
  data: Record<string, unknown>
}
export interface Backup {
  format: 'aether-backup'
  version: 1
  app: string
  createdAt: string
  sections: BackupSection[]
  notes?: { vaults: BackupVault[]; activeVault?: string; images: Record<string, string> }
  themes?: { settings: Partial<AppSettings>; vaults: Record<string, Pick<Vault, 'theme' | 'canvasBg'>> }
  settings?: { settings: Partial<AppSettings>; ui: Record<string, unknown> }
}

const read = <T,>(key: string): T | undefined => {
  try {
    const raw = getItem(P + key)
    return raw == null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}
const write = (key: string, value: unknown) => setItem(P + key, JSON.stringify(value))

/** Workspaces as stored (the app may not have saved the list yet on a fresh install). */
function storedVaults(): Vault[] {
  const v = read<Vault[]>('vaults')
  return v?.length ? v : [{ id: DEFAULT_VAULT_ID, name: read<AppSettings>('settings')?.vaultName || 'Aether', createdAt: Date.now() }]
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
const dataUrlToBlob = async (u: string) => (await fetch(u)).blob()

/** Build the backup for the chosen sections. */
export async function createBackup(sections: BackupSection[], onlyVault?: string): Promise<Backup> {
  const b: Backup = { format: 'aether-backup', version: 1, app: pkg.version, createdAt: new Date().toISOString(), sections: [...sections] }
  const vaults = storedVaults().filter((v) => !onlyVault || v.id === onlyVault)
  const settings = read<Partial<AppSettings>>('settings') ?? {}

  if (sections.includes('notes')) {
    const images: Record<string, string> = {}
    const out: BackupVault[] = []
    for (const v of vaults) {
      const data: Record<string, unknown> = {}
      for (const k of VAULT_DATA) {
        const val = read(vaultKey(v.id, k))
        if (val !== undefined) data[k] = val
      }
      out.push({ id: v.id, name: v.name, createdAt: v.createdAt, ...(v.seed ? { seed: v.seed } : {}), data })
      // photos used by the notes
      for (const m of JSON.stringify(data.notes ?? []).matchAll(/"id":"(img-[a-z0-9-]+)"/g)) images[m[1]] = ''
    }
    const stored = new Set((await allIds().catch(() => [])) as string[])
    for (const id of Object.keys(images)) {
      const blob = stored.has(id) ? await getImage(id).catch(() => undefined) : undefined
      if (blob) images[id] = await blobToDataUrl(blob)
      else delete images[id]
    }
    b.notes = { vaults: out, activeVault: read<string>('active-vault'), images }
  }
  if (sections.includes('themes')) {
    const s: Partial<AppSettings> = {}
    for (const k of THEME_KEYS) if (settings[k] !== undefined) (s as Record<string, unknown>)[k] = settings[k]
    const per: Record<string, Pick<Vault, 'theme' | 'canvasBg'>> = {}
    for (const v of vaults) if (v.theme) per[v.id] = { theme: v.theme, ...(v.canvasBg ? { canvasBg: v.canvasBg } : {}) }
    b.themes = { settings: s, vaults: per }
  }
  if (sections.includes('settings')) {
    const s: Record<string, unknown> = { ...settings }
    for (const k of THEME_KEYS) delete s[k]
    delete s.vaultName
    const ui: Record<string, unknown> = {}
    for (const k of UI_KEYS) {
      const val = read(k)
      if (val !== undefined) ui[k] = val
    }
    b.settings = { settings: s as Partial<AppSettings>, ui }
  }
  return b
}

export const backupFileName = (board?: string) => {
  const day = new Date().toISOString().slice(0, 10)
  // file names stay plain ASCII (the desktop side keeps only letters, digits, - _ .)
  const slug = board ? board.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) : ''
  return board ? `aether-board-${slug || 'board'}-${day}.${BACKUP_EXT}` : `aether-backup-${day}.${BACKUP_EXT}`
}

/** Read and check a backup file. Throws a short, user-facing reason when it is not one. */
export function parseBackup(text: string): Backup {
  let b: Backup
  try {
    b = JSON.parse(text)
  } catch {
    throw new Error('not-json')
  }
  if (!b || b.format !== 'aether-backup' || typeof b.version !== 'number') throw new Error('not-aether')
  if (b.version > 1) throw new Error('too-new')
  b.sections = BACKUP_SECTIONS.filter((s) => b[s] != null)
  return b
}

/** What a backup holds, for the confirmation. */
export function summarize(b: Backup) {
  const vaults = b.notes?.vaults ?? []
  const notes = vaults.reduce((n, v) => n + (Array.isArray(v.data.notes) ? v.data.notes.length : 0), 0)
  return { vaults: vaults.length, notes, images: Object.keys(b.notes?.images ?? {}).length, app: b.app, createdAt: b.createdAt }
}

/** Write the chosen sections into storage, then reload so every part of the app picks them up. */
export async function applyBackup(b: Backup, sections: BackupSection[], opts: { revert?: boolean } = {}) {
  // open editors hand over their last changes first, so the snapshot below has them
  await flush()
  if (!opts.revert) {
    // a way back: everything as it is now, kept until the next import
    try {
      write(BEFORE_IMPORT, await createBackup(BACKUP_SECTIONS))
    } catch {
      /* too big for the browser's storage — the import still goes ahead, only without the way back */
    }
  }
  // nothing may write the old in-memory state back over the imported data from here on
  suspendPersistence()
  let vaults = storedVaults()
  if (opts.revert && b.notes) {
    // back to exactly what was there: workspaces that came with the import go away
    const keep = new Set(b.notes.vaults.map((v) => v.id))
    for (const v of vaults) if (!keep.has(v.id)) deleteVaultData(v.id)
    vaults = vaults.filter((v) => keep.has(v.id))
  }
  let settings = read<Partial<AppSettings>>('settings') ?? {}

  if (sections.includes('notes') && b.notes) {
    for (const [id, url] of Object.entries(b.notes.images)) {
      try {
        await putImage(id, await dataUrlToBlob(url))
      } catch {
        /* a broken picture should not stop the rest */
      }
    }
    for (const bv of b.notes.vaults) {
      deleteVaultData(bv.id)
      for (const k of VAULT_DATA) if (bv.data[k] !== undefined) write(vaultKey(bv.id, k), bv.data[k])
      const meta: Vault = { id: bv.id, name: bv.name, createdAt: bv.createdAt, ...(bv.seed ? { seed: bv.seed } : {}) }
      const at = vaults.findIndex((v) => v.id === bv.id)
      if (at >= 0) vaults[at] = { ...meta, theme: vaults[at].theme, canvasBg: vaults[at].canvasBg }
      else vaults = [...vaults, meta]
    }
    const active = b.notes.activeVault
    if (active && vaults.some((v) => v.id === active)) write('active-vault', active)
  }
  if (sections.includes('themes') && b.themes) {
    settings = { ...settings, ...b.themes.settings }
    vaults = vaults.map((v) => {
      const t = b.themes!.vaults[v.id]
      if (t) return { ...v, theme: t.theme, canvasBg: t.canvasBg }
      // a workspace that came with the notes but had no own theme in the file follows the app theme
      return b.notes?.vaults.some((bv) => bv.id === v.id) ? { ...v, theme: undefined, canvasBg: undefined } : v
    })
  }
  if (sections.includes('settings') && b.settings) {
    settings = { ...settings, ...b.settings.settings }
    for (const [k, val] of Object.entries(b.settings.ui)) if ((UI_KEYS as readonly string[]).includes(k)) write(k, val)
    write('lang-chosen', true)
  }
  write('settings', settings)
  write('vaults', vaults)
  if (opts.revert) removeItem(P + BEFORE_IMPORT)
  write(IMPORT_DONE, { at: Date.now(), revert: !!opts.revert })
  await flush()
  window.location.reload()
}

/** The state right before the last import (Settings → General → "Restore as before"). */
export const BEFORE_IMPORT = 'before-import'
/** Set by an import for the next launch: show "Imported · Undo" once. */
export const IMPORT_DONE = 'import-done'
export const hasPreImport = () => getItem(P + BEFORE_IMPORT) != null
/** Put everything back as it was before the last import (the app reloads). */
export async function revertImport() {
  const raw = getItem(P + BEFORE_IMPORT)
  if (!raw) return
  const snap = JSON.parse(raw) as Backup
  await applyBackup(snap, snap.sections, { revert: true })
}

/**
 * Save the file. In the desktop app it goes to the Downloads folder (returns the full path);
 * in a browser it is downloaded the usual way (returns null).
 */
export async function saveBackupFile(name: string, text: string): Promise<string | null> {
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('save_backup', { name, contents: text })
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
  return null
}

/** Show a saved file in Finder / Explorer (desktop app only). */
export async function revealFile(path: string) {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(path)
  } catch {
    /* older opener / browser: nothing to do */
  }
}
