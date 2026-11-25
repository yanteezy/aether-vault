/**
 * Vault folders on disk (desktop only): thin wrappers over `src-tauri/src/vault_fs.rs`.
 * `vault` is the folder name inside the data folder, `file` a plain file name inside the vault.
 * Not used by the app yet — step 1b moves the data here.
 */
import { invoke } from '@tauri-apps/api/core'

export interface TextFile {
  file: string
  text: string
}
export interface VaultEntry {
  dir: string
  /** Raw `.aether/vault.json`. */
  meta: string
}
export interface VaultSnapshot {
  meta: string
  notes: TextFile[]
  canvases: TextFile[]
  /** Board name → raw `.aether/canvas-extra/<name>.json`. */
  extras: Record<string, string>
  attachments: string[]
  /** Files that exist but could not be read: they are NOT deleted notes. */
  unreadable: string[]
}

export const listVaults = () => invoke<VaultEntry[]>('vault_list')
export const readVault = (vault: string) => invoke<VaultSnapshot>('vault_read', { vault })
/** `vault: null` makes a new folder named after `name`. Returns the folder name. */
export const writeVaultMeta = (vault: string | null, name: string, meta: string) =>
  invoke<string>('vault_meta_write', { vault, name, meta })

/** The free, safe file name for a note with this title (`currentFile` = the name it has now). */
export const noteFileName = (vault: string, title: string, currentFile?: string) =>
  invoke<string>('note_name', { vault, title, currentFile: currentFile ?? null })
/** `create` fails with `exists` instead of replacing another note. */
export const writeNote = (vault: string, file: string, text: string, create = false) =>
  invoke<void>('note_write', { vault, file, text, create })
/** Returns the new file name. */
export const renameNote = (vault: string, file: string, title: string) => invoke<string>('note_rename', { vault, file, title })
/** Moves the file to the vault's `.trash`. */
export const deleteNote = (vault: string, file: string) => invoke<void>('note_delete', { vault, file })

export const writeCanvas = (vault: string, file: string, canvas: string, extra: string) =>
  invoke<void>('canvas_write', { vault, file, canvas, extra })

// HTTP headers are ASCII only, names may be in any language
export const writeAttachment = (vault: string, name: string, bytes: Uint8Array) =>
  invoke<void>('attachment_write', bytes, {
    headers: { 'x-vault': encodeURIComponent(vault), 'x-name': encodeURIComponent(name) },
  })
/** Undefined when there is no such file. */
export async function readAttachment(vault: string, name: string): Promise<Uint8Array | undefined> {
  const buf = await invoke<ArrayBuffer>('attachment_read', { vault, name })
  return buf.byteLength ? new Uint8Array(buf) : undefined
}
export const deleteAttachment = (vault: string, name: string) => invoke<void>('attachment_delete', { vault, name })
