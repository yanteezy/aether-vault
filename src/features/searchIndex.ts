/**
 * Keeps the search index (`src-tauri/src/index.rs`) up to date with the vault folders. Desktop only.
 *
 * The index only mirrors the files: it fills in the background, and a failure here never touches the notes.
 * The search box doesn't use it yet.
 */
import { invoke } from '@tauri-apps/api/core'
import type { Connection, NoteCardData } from '../types/note'

export interface IndexDoc {
  file: string
  id: string
  title: string
  body: string
  tags: string[]
  links: string[]
}
export interface SearchHit {
  vault: string
  id: string
  title: string
  /** Text around the match; the matched words sit between U+0002 and U+0003. */
  snippet: string
}
export interface NoteRef {
  vault: string
  id: string
  title: string
}

export const searchIndex = (query: string, limit = 30) => invoke<SearchHit[]>('index_search', { query, limit })
export const noteBacklinks = (vault: string, noteId: string) => invoke<NoteRef[]>('index_backlinks', { vault, noteId })
export const indexTags = () => invoke<[string, number][]>('index_tags')

const io = {
  keep: (vaults: string[]) => invoke<void>('index_keep', { vaults }),
  plan: (vault: string) => invoke<string[]>('index_plan', { vault }),
  put: (vault: string, docs: IndexDoc[]) => invoke<void>('index_put', { vault, docs }),
  links: (vault: string, links: [string, string][]) => invoke<void>('index_canvas_links', { vault, links }),
}
export type IndexIo = typeof io

export interface IndexedVault {
  dir: string
  /** file name → the note stored in it */
  notes: Map<string, NoteCardData>
  connections: Connection[]
}

/** `[[Title]]`, `[[Title|shown text]]`, `[[Title#heading]]`, and the same with `!` in front. */
const WIKI = /\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g

export function toDoc(file: string, note: NoteCardData): IndexDoc {
  const written = [note.body, ...(note.checklist ?? []).map((i) => i.label)].filter(Boolean).join('\n')
  return {
    file,
    id: note.id,
    title: note.title,
    // code and the card's address are searchable, but `[[…]]` inside code is not a link
    body: [written, note.code?.content, note.link?.url].filter(Boolean).join('\n'),
    tags: note.tags,
    links: [...new Set([...written.matchAll(WIKI)].map((m) => m[1].trim()).filter(Boolean))],
  }
}

const BATCH = 500

/** Bring the index up to date with what is on disk. `progress` counts the notes of the current vault. */
export async function syncIndex(vaults: IndexedVault[], target: IndexIo = io, progress?: (done: number, total: number) => void) {
  await target.keep(vaults.map((v) => v.dir))
  for (const vault of vaults) {
    const stale = await target.plan(vault.dir)
    // a stale file without a note is one the app couldn't read: it stays out of the index
    const docs = stale.flatMap((file) => {
      const note = vault.notes.get(file)
      return note ? [toDoc(file, note)] : []
    })
    for (let i = 0; i < docs.length; i += BATCH) {
      await target.put(vault.dir, docs.slice(i, i + BATCH))
      progress?.(Math.min(i + BATCH, docs.length), docs.length)
    }
    await target.links(vault.dir, vault.connections.map((c): [string, string] => [c.from, c.to]))
  }
}

/** Run now and after later changes: one run at a time, changes during a run cause one more. */
export function createIndexer(read: () => IndexedVault[], target: IndexIo = io, delay = 2000) {
  let running: Promise<void> | null = null
  let again = false
  let timer = 0
  const run = (): Promise<void> => {
    window.clearTimeout(timer)
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await syncIndex(read(), target)
      } while (again)
    })()
      .catch((e) => console.warn('search index:', e))
      .finally(() => (running = null))
    return running
  }
  return {
    run,
    soon: () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void run(), delay)
    },
  }
}
