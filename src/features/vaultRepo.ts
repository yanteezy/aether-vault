/**
 * The owner of one vault's data: notes, connections, frames, buttons, drawings and the canvas view.
 *
 * Every view (canvas today; document, table, kanban… later) reads and changes this data through the repository,
 * never through storage keys. The repository keeps the values in memory, tells subscribers about changes
 * (compatible with `useSyncExternalStore`) and saves them through a `VaultBackend`.
 *
 * Saving works exactly like `usePersistentState` did: a change is written 200 ms after the last one in a burst,
 * right away on `aether:flush` / `beforeunload`, and never after `suspendPersistence()` (backup import).
 *
 * Today the only backend is `KeyValueBackend`: the same JSON keys as before (`vaultKey(id, kind)`) through
 * `store.ts`, so the save status, the error banner and `flush()` keep working. A file backend replaces it later.
 */
import { isPersistenceSuspended } from '../hooks/usePersistentState'
import type { CanvasTransform } from '../hooks/useCanvasTransform'
import { removeVaultKeys, vaultKey } from '../hooks/vaultKeys'
import type { Connection, Frame, InkStroke, NoteCardData, TagChip } from '../types/note'
import { getItem, P, setItem } from './store'

/** Everything that belongs to one vault, by kind (the kind is also the storage key suffix). */
export interface VaultData {
  notes: NoteCardData[]
  connections: Connection[]
  frames: Frame[]
  chips: TagChip[]
  ink: InkStroke[]
  'canvas-transform': CanvasTransform
}
export type VaultKind = keyof VaultData
export const VAULT_KINDS: readonly VaultKind[] = ['notes', 'connections', 'frames', 'chips', 'ink', 'canvas-transform']

export type Updater<T> = T | ((prev: T) => T)

/** Where a vault's data lives. Calls are synchronous: the store keeps everything in memory and writes behind. */
export interface VaultBackend {
  /** Whatever is stored for the vault; a missing or unreadable kind is left out. */
  load(vaultId: string): Partial<VaultData>
  save<K extends VaultKind>(vaultId: string, kind: K, value: VaultData[K]): void
  remove(vaultId: string): void
}

/** The 0.2.x format: one JSON value per kind under `aethel-vault:` + `vaultKey(id, kind)`. */
export const KeyValueBackend: VaultBackend = {
  load(vaultId) {
    const out: Partial<Record<VaultKind, unknown>> = {}
    for (const kind of VAULT_KINDS) {
      try {
        const raw = getItem(P + vaultKey(vaultId, kind))
        if (raw !== null) out[kind] = JSON.parse(raw)
      } catch {
        /* unreadable → treated as missing, like usePersistentState did */
      }
    }
    return out as Partial<VaultData>
  },
  save(vaultId, kind, value) {
    setItem(P + vaultKey(vaultId, kind), JSON.stringify(value))
  },
  remove(vaultId) {
    removeVaultKeys(vaultId)
  },
}

const SAVE_DELAY = 200

export class VaultRepository {
  readonly vaultId: string
  private readonly backend: VaultBackend
  private readonly values: Partial<Record<VaultKind, unknown>>
  private readonly listeners = new Map<VaultKind, Set<() => void>>()
  private readonly timers = new Map<VaultKind, number>()
  private readonly pending = new Set<VaultKind>()
  private subscribers = 0
  private disposed = false

  constructor(vaultId: string, backend: VaultBackend = KeyValueBackend) {
    this.vaultId = vaultId
    this.backend = backend
    this.values = { ...backend.load(vaultId) }
  }

  // ---------- reading ----------
  has(kind: VaultKind) {
    return kind in this.values
  }
  get<K extends VaultKind>(kind: K): VaultData[K] | undefined {
    return this.values[kind] as VaultData[K] | undefined
  }
  listNotes(): NoteCardData[] {
    return this.get('notes') ?? []
  }
  getNote(id: string): NoteCardData | undefined {
    return this.listNotes().find((n) => n.id === id)
  }

  /** A starting value for a kind that has nothing stored. Kept in memory only, saved with the first change. */
  ensure<K extends VaultKind>(kind: K, initial: VaultData[K]): VaultData[K] {
    if (!this.has(kind)) this.values[kind] = initial
    return this.values[kind] as VaultData[K]
  }

  // ---------- changing ----------
  set<K extends VaultKind>(kind: K, next: Updater<VaultData[K]>) {
    const prev = this.values[kind] as VaultData[K]
    const value = typeof next === 'function' ? (next as (p: VaultData[K]) => VaultData[K])(prev) : next
    if (Object.is(value, prev) && this.has(kind)) return
    this.values[kind] = value
    this.schedule(kind)
    this.listeners.get(kind)?.forEach((fn) => fn())
  }
  updateNote(id: string, patch: Partial<NoteCardData>) {
    this.set('notes', (prev) => (prev ?? []).map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)))
  }

  // ---------- subscribing ----------
  /** Called after every change of `kind`. Returns the unsubscribe function. */
  subscribe(kind: VaultKind, fn: () => void): () => void {
    let set = this.listeners.get(kind)
    if (!set) this.listeners.set(kind, (set = new Set()))
    set.add(fn)
    this.subscribers++
    let done = false
    return () => {
      if (done) return
      done = true
      set.delete(fn)
      this.subscribers--
      if (this.subscribers === 0) releaseLater(this)
    }
  }
  get subscriberCount() {
    return this.subscribers
  }

  // ---------- saving ----------
  private schedule(kind: VaultKind) {
    if (this.disposed) return
    window.clearTimeout(this.timers.get(kind))
    this.timers.set(kind, window.setTimeout(() => this.write(kind), SAVE_DELAY))
    if (!this.pending.size) {
      window.addEventListener('beforeunload', this.flush)
      // closing the window / relaunching after an update / importing: hand the changes over right away
      window.addEventListener('aether:flush', this.flush)
    }
    this.pending.add(kind)
  }
  private write(kind: VaultKind) {
    window.clearTimeout(this.timers.get(kind))
    this.timers.delete(kind)
    this.pending.delete(kind)
    if (!this.pending.size) this.unlisten()
    if (this.disposed || isPersistenceSuspended()) return
    try {
      this.backend.save(this.vaultId, kind, this.values[kind] as VaultData[typeof kind])
    } catch {
      /* reported by the store (save status banner) */
    }
  }
  private unlisten() {
    window.removeEventListener('beforeunload', this.flush)
    window.removeEventListener('aether:flush', this.flush)
  }
  /** Write every pending change now. */
  flush = () => {
    for (const kind of [...this.pending]) this.write(kind)
  }
  /** Drop pending changes without writing them; the repository is dead afterwards (vault deleted / replaced). */
  dispose() {
    this.disposed = true
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers.clear()
    this.pending.clear()
    this.unlisten()
  }
}

// ---------- registry: one repository per vault ----------
const repos = new Map<string, VaultRepository>()

/** The repository of a vault (created on first use, shared by every view that shows the vault). */
export function getVaultRepo(vaultId: string): VaultRepository {
  let repo = repos.get(vaultId)
  if (!repo) repos.set(vaultId, (repo = new VaultRepository(vaultId)))
  return repo
}

/**
 * Nobody shows the vault any more (its tab was switched away or closed): save what is pending and forget the
 * in-memory copy, so closed vaults don't stay in memory. Deferred, so React's StrictMode
 * unsubscribe → subscribe does not drop it.
 */
function releaseLater(repo: VaultRepository) {
  queueMicrotask(() => {
    if (repo.subscriberCount > 0 || repos.get(repo.vaultId) !== repo) return
    repo.flush()
    repos.delete(repo.vaultId)
  })
}

/** Throw a vault's repository away without saving (before its data is deleted or replaced). */
export function discardVaultRepo(vaultId: string) {
  repos.get(vaultId)?.dispose()
  repos.delete(vaultId)
}
