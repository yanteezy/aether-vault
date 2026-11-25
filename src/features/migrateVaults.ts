/**
 * Move every vault from the 0.2.x keys into vault folders (step 1b). It only reads the old data: the keys and
 * the photo folder stay as they were, whatever happens here.
 *
 * A vault counts as moved only when reading its new files gives back exactly the old data (positions rounded to
 * whole pixels, as the format requires). Any difference is a failure, and the app must stay on the old format.
 * Safe to run again after a failure or a crash: the same folder is found by the vault id and brought up to date.
 *
 * Not called by the app yet.
 */
import { VaultFiles, type VaultIo } from './vaultFiles'
import type * as vaultFs from './vaultFs'
import type { VaultData } from './vaultRepo'
import { resolveFontSize, type Vault } from '../types/note'

export type MigrationIo = VaultIo & Pick<typeof vaultFs, 'listVaults' | 'readVault' | 'writeVaultMeta' | 'writeAttachment'>

export interface MigrationSource {
  vaults: Vault[]
  /** The stored data of a vault; kinds that were never saved are left out. */
  load: (vaultId: string) => Partial<VaultData>
  /** A photo of the old store, or undefined when it is already missing there. */
  image: (id: string) => Promise<{ bytes: Uint8Array; ext: string } | undefined>
}

export interface VaultResult {
  vaultId: string
  dir?: string
  notes: number
  /** Photos that notes refer to but the old store doesn't have: reported, not a reason to fail. */
  missingImages: string[]
  /** Set when the vault was not moved. */
  error?: string
}

const DEFAULT_VIEW = { x: 0, y: 0, scale: 1 }

const rounded = <T extends { x: number; y: number; width: number; height: number }>(o: T): T => ({
  ...o,
  x: Math.round(o.x),
  y: Math.round(o.y),
  width: Math.round(o.width),
  height: Math.round(o.height),
})

/** The old data as the new format is expected to give it back. */
export function expectedAfter(old: Partial<VaultData>): VaultData {
  const notes = (old.notes ?? []).map((n) =>
    rounded({ ...n, tags: n.tags ?? [], ...(n.fontSize === undefined ? {} : { fontSize: resolveFontSize(n.fontSize) }) }),
  )
  const ids = new Set(notes.map((n) => n.id))
  return {
    notes,
    // an arrow to a note that no longer exists was never shown
    connections: (old.connections ?? []).filter((c) => ids.has(c.from) && ids.has(c.to)),
    frames: (old.frames ?? []).map(rounded),
    chips: old.chips ?? [],
    ink: old.ink ?? [],
    'canvas-transform': old['canvas-transform'] ?? DEFAULT_VIEW,
  }
}

/** JSON with sorted keys, so that only real differences count. */
const stable = (value: unknown) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  )

/** Where two data sets differ, by kind and id only: the message must not carry the user's text. */
export function differences(want: VaultData, got: VaultData): string[] {
  const out: string[] = []
  for (const kind of ['notes', 'connections', 'frames', 'chips', 'ink'] as const) {
    const a = want[kind] as { id: string }[]
    const b = got[kind] as { id: string }[]
    if (a.length !== b.length) out.push(`${kind}: ${a.length} → ${b.length}`)
    const byId = new Map(b.map((o) => [o.id, o]))
    for (const o of a) {
      const other = byId.get(o.id) as Record<string, unknown> | undefined
      if (other && stable(o) === stable(other)) continue
      const fields = other
        ? Object.keys({ ...o, ...other }).filter((k) => stable((o as Record<string, unknown>)[k]) !== stable(other[k]))
        : ['missing']
      out.push(`${kind} ${o.id}: ${fields.join(', ')}`)
    }
  }
  if (stable(want['canvas-transform']) !== stable(got['canvas-transform'])) out.push('canvas-transform')
  return out
}

async function findDir(io: MigrationIo, vaultId: string) {
  for (const entry of await io.listVaults()) {
    try {
      if ((JSON.parse(entry.meta) as { id?: string }).id === vaultId) return entry.dir
    } catch {
      /* someone else's or a broken marker: not ours */
    }
  }
  return null
}

async function migrateOne(vault: Vault, source: MigrationSource, io: MigrationIo): Promise<VaultResult> {
  const result: VaultResult = { vaultId: vault.id, notes: 0, missingImages: [] }
  try {
    const want = expectedAfter(source.load(vault.id))
    result.notes = want.notes.length
    if (new Set(want.notes.map((n) => n.id)).size !== want.notes.length) throw new Error('two notes share an id')

    const meta = JSON.stringify({ ...vault, type: 'canvas' }, null, 2) + '\n'
    const dir = await io.writeVaultMeta(await findDir(io, vault.id), vault.name, meta)
    result.dir = dir

    const before = await io.readVault(dir)
    const { files } = VaultFiles.open(dir, before, io)
    for (const id of new Set(want.notes.flatMap((n) => (n.image ? [n.image.id] : [])))) {
      const image = await source.image(id)
      if (!image) {
        result.missingImages.push(id)
        continue
      }
      const name = `${id}.${image.ext}`
      if (!before.attachments.includes(name)) await io.writeAttachment(dir, name, image.bytes)
      files.attachmentAdded(name)
    }
    await files.sync(want)

    // the proof: read the folder again, as the next launch would
    const check = VaultFiles.open(dir, await io.readVault(dir), io)
    if (check.files.problems.length) throw new Error(`unreadable files: ${check.files.problems.length}`)
    const wrong = differences(want, check.data)
    if (wrong.length) throw new Error(`does not match: ${wrong.slice(0, 5).join('; ')}`)
  } catch (e) {
    result.error = String((e as Error)?.message ?? e)
  }
  return result
}

/** `ok` only when every vault moved. */
export async function migrateVaults(source: MigrationSource, io: MigrationIo) {
  const results: VaultResult[] = []
  // one at a time: two vaults with the same name must not race for a folder
  for (const vault of source.vaults) results.push(await migrateOne(vault, source, io))
  return { ok: results.every((r) => !r.error), results }
}
