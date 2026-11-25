/**
 * Vault data kept in vault folders (step 1b): the `VaultBackend` over `VaultFiles`, and the switch to it.
 *
 * Everything is read at launch, so the backend stays synchronous like the key-value one: a change goes into
 * memory at once and to disk through one queue. A failed write is shown by the save banner and retried.
 *
 * Once `storage-format` says "files" the app stays on files. Who may make the first move is decided in
 * `fileStoreBoot.ts`.
 */
import { getVaultBackend, KeyValueBackend, setVaultBackend, VAULT_KINDS, type VaultBackend, type VaultData } from './vaultRepo'
import { VaultFiles } from './vaultFiles'
import { migrateVaults, type MigrationIo, type MigrationSource, type VaultResult } from './migrateVaults'
import type * as vaultFs from './vaultFs'
import { vaultKey, DEFAULT_VAULT_ID } from '../hooks/vaultKeys'
import { flush, getItem, P, readJson, registerWriter, removeItem, writeJson, writerSaved } from './store'
import type { Vault } from '../types/note'

export const FORMAT_KEY = 'storage-format'
export interface FormatState {
  format: 'files'
  /** vault id → folder name. A recorded folder that is gone stops the launch. */
  dirs: Record<string, string>
}

export type FileIo = MigrationIo & Pick<typeof vaultFs, 'deleteVault'>
export type Photo = MigrationSource['image']

/** A little longer than the 200 ms in which the app saves the list of workspaces (a new vault takes its name from it). */
const WRITE_DELAY = 400
const RETRY_MAX = 30000

const complete = (data: Partial<VaultData>): VaultData => ({
  notes: [],
  connections: [],
  frames: [],
  chips: [],
  ink: [],
  'canvas-transform': { x: 0, y: 0, scale: 1 },
  ...data,
})

interface Entry {
  data: Partial<VaultData>
  files?: VaultFiles
}

export class FileStore implements VaultBackend {
  private readonly io: FileIo
  private readonly photo: Photo
  private readonly vaults = new Map<string, Entry>()
  private readonly dirs: Record<string, string>
  private readonly dirty = new Set<string>()
  /** folders of deleted vaults still to be moved to the trash */
  private readonly trash = new Set<string>()
  private timer = 0
  private retry = 1000
  private running: Promise<boolean> | null = null
  failure: unknown
  /** Called after changes reached the disk (the search index follows). */
  onWritten?: () => void

  private constructor(io: FileIo, photo: Photo, dirs: Record<string, string>) {
    this.io = io
    this.photo = photo
    this.dirs = { ...dirs }
  }

  /** Throws instead of starting without a vault: empty must never be written over data that is merely absent. */
  static async open(state: FormatState, io: FileIo, photo: Photo): Promise<FileStore> {
    const store = new FileStore(io, photo, state.dirs)
    const found = new Set((await io.listVaults()).map((v) => v.dir))
    for (const [id, dir] of Object.entries(state.dirs)) {
      if (!found.has(dir)) throw new Error(`missing-dir:${dir}`)
      const { files, data } = VaultFiles.open(dir, await io.readVault(dir), io)
      store.vaults.set(id, { data, files })
    }
    return store
  }

  // ---------- VaultBackend ----------
  load(vaultId: string): Partial<VaultData> {
    return { ...this.vaults.get(vaultId)?.data }
  }
  save<K extends keyof VaultData>(vaultId: string, kind: K, value: VaultData[K], all?: Partial<VaultData>) {
    let entry = this.vaults.get(vaultId)
    if (!entry) this.vaults.set(vaultId, (entry = { data: {} }))
    // `all`: the kinds the app has but hasn't saved yet (the starting guide), so the folder gets them too
    entry.data = { ...entry.data, ...all, [kind]: value }
    this.dirty.add(vaultId)
    this.schedule(WRITE_DELAY)
  }
  remove(vaultId: string) {
    this.vaults.delete(vaultId)
    this.dirty.delete(vaultId)
    const dir = this.dirs[vaultId]
    if (dir === undefined) return
    delete this.dirs[vaultId]
    this.trash.add(dir)
    this.schedule(0)
  }

  /** Photos of notes in memory; null when some note files could not be read, so nothing may be tidied away. */
  usedImages(): Set<string> | null {
    const used = new Set<string>()
    for (const { data, files } of this.vaults.values()) {
      if (files?.problems.length) return null
      for (const note of data.notes ?? []) if (note.image) used.add(note.image.id)
    }
    return used
  }
  get problems(): string[] {
    return [...this.vaults.values()].flatMap((e) => e.files?.problems.map((p) => `${e.files!.dir}/${p}`) ?? [])
  }
  /** What is on disk now, for the search index. */
  indexed(): { dir: string; notes: ReturnType<VaultFiles['notesByFile']>; connections: VaultData['connections'] }[] {
    return [...this.vaults.values()].flatMap(({ data, files }) =>
      files ? [{ dir: files.dir, notes: files.notesByFile(), connections: data.connections ?? [] }] : [],
    )
  }
  get pending() {
    return this.dirty.size > 0 || this.trash.size > 0
  }

  // ---------- writing ----------
  private schedule(delay: number) {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), delay)
  }

  /** Write everything pending. False when something could not be written (it stays pending). */
  flush = (): Promise<boolean> => {
    this.running ??= this.drain().finally(() => (this.running = null))
    return this.running
  }

  private async drain(): Promise<boolean> {
    window.clearTimeout(this.timer)
    try {
      while (this.pending) {
        for (const dir of [...this.trash]) {
          await this.io.deleteVault(dir)
          this.trash.delete(dir)
          this.remember()
        }
        for (const id of [...this.dirty]) {
          this.dirty.delete(id)
          try {
            await this.write(id)
          } catch (e) {
            if (this.vaults.has(id)) this.dirty.add(id)
            throw e
          }
        }
      }
      this.failure = undefined
      this.retry = 1000
      writerSaved(undefined)
      this.onWritten?.()
      return true
    } catch (e) {
      this.failure = e
      this.retry = Math.min(this.retry * 2, RETRY_MAX)
      this.schedule(this.retry)
      writerSaved(e)
      return false
    }
  }

  private async write(id: string) {
    const entry = this.vaults.get(id)
    if (!entry) return
    if (!entry.files) {
      const vaults = readJson<Vault[]>('vaults') ?? []
      const vault = vaults.find((v) => v.id === id) ?? { id, name: id === DEFAULT_VAULT_ID ? 'Aether' : id, createdAt: Date.now() }
      const dir = await this.io.writeVaultMeta(null, vault.name, JSON.stringify({ ...vault, type: 'canvas' }, null, 2) + '\n')
      entry.files = VaultFiles.open(dir, await this.io.readVault(dir), this.io).files
      this.dirs[id] = dir
      this.remember()
    }
    const data = complete(entry.data)
    for (const note of data.notes) {
      if (!note.image || entry.files.hasAttachment(note.image.id)) continue
      const photo = await this.photo(note.image.id)
      if (!photo) continue
      const name = `${note.image.id}.${photo.ext}`
      await this.io.writeAttachment(entry.files.dir, name, photo.bytes)
      entry.files.attachmentAdded(name)
    }
    await entry.files.sync(data)
  }

  private remember() {
    writeJson(FORMAT_KEY, { format: 'files', dirs: this.dirs } satisfies FormatState)
  }
}

// ---------- switching over ----------

/** The old data for the migration. Unlike the app, it refuses a damaged key instead of treating it as empty. */
export function strictKeyData(vaultId: string): Partial<VaultData> {
  const out: Record<string, unknown> = {}
  for (const kind of VAULT_KINDS) {
    const raw = getItem(P + vaultKey(vaultId, kind))
    if (raw === null) continue
    try {
      out[kind] = JSON.parse(raw)
    } catch {
      throw new Error(`damaged data: ${vaultKey(vaultId, kind)}`)
    }
  }
  return out as Partial<VaultData>
}

export interface StartOptions {
  io: FileIo
  photo: Photo
  /** Whether a launch may move the old data to files. */
  migrate: boolean
  /** Writes the safety copy made before the move; a failure cancels the move. */
  backup: () => Promise<unknown>
}
export type StartResult =
  | { mode: 'keys' }
  | { mode: 'files'; store: FileStore }
  | { mode: 'failed'; reason: string; results?: VaultResult[] }

/**
 * Decide where vault data lives, moving it first when allowed. A failed move leaves the app on the old keys;
 * a vault folder missing after the move throws.
 */
export async function startFileStore({ io, photo, migrate, backup }: StartOptions): Promise<StartResult> {
  let state = readJson<FormatState>(FORMAT_KEY)
  if (state?.format !== 'files') {
    if (!migrate) return { mode: 'keys' }
    try {
      const listed = readJson<Vault[]>('vaults')
      const vaults = listed?.length ? listed : [{ id: DEFAULT_VAULT_ID, name: 'Aether', createdAt: Date.now() }]
      await backup()
      // a brand-new install has nothing to move: its first change makes the folder
      const withData = vaults.filter((v) => Object.keys(strictKeyData(v.id)).length > 0)
      const { ok, results } = await migrateVaults({ vaults: withData, load: strictKeyData, image: photo }, io)
      if (!ok) return { mode: 'failed', reason: results.find((r) => r.error)!.error!, results }
      state = { format: 'files', dirs: Object.fromEntries(results.map((r) => [r.vaultId, r.dir!])) }
      writeJson(FORMAT_KEY, state)
      if (!(await flush())) {
        // the marker must not reach the disk later, while the app goes on writing the old keys
        removeItem(P + FORMAT_KEY)
        return { mode: 'failed', reason: 'could not save the new format' }
      }
    } catch (e) {
      return { mode: 'failed', reason: String((e as Error)?.message ?? e) }
    }
  }
  const store = await FileStore.open(state, io, photo)
  setVaultBackend(store)
  registerWriter({ flush: store.flush, pending: () => store.pending, failure: () => store.failure })
  return { mode: 'files', store }
}

/** For tests: back to the old keys. */
export function resetVaultBackend() {
  if (getVaultBackend() !== KeyValueBackend) setVaultBackend(KeyValueBackend)
}
