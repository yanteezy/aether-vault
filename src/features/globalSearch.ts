/**
 * Search over every vault (Ctrl+Space). With vault folders it asks the search index; without them (browser,
 * old data) or when the index fails, it looks through the notes in memory.
 */
import { searchIndex, toDoc } from './searchIndex'
import { getVaultBackend } from './vaultRepo'
import { FileStore } from './fileStore'
import type { NoteCardData, Vault } from '../types/note'

export interface FoundNote {
  vaultId: string
  noteId: string
  title: string
  /** Pieces of the text around the match; `hit` marks the matched ones. */
  snippet: { text: string; hit: boolean }[]
}

export const LIMIT = 30
const AROUND = 90

/** The words of a query, as the index sees them: runs of letters and digits. */
const words = (query: string) => query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** The index marks matches with U+0002 … U+0003. */
export function parseSnippet(snippet: string): FoundNote['snippet'] {
  return snippet
    .split(/(\u0002[^\u0003]*\u0003)/)
    .filter(Boolean)
    .map((p) => (p.startsWith('\u0002') ? { text: p.slice(1, -1), hit: true } : { text: p, hit: false }))
}

function cut(body: string, found: string[]): FoundNote['snippet'] {
  const flat = body.replace(/\s+/g, ' ')
  const lower = flat.toLocaleLowerCase()
  const positions = found.map((w) => [lower.indexOf(w), w.length] as const).filter(([i]) => i >= 0)
  const [at, length] = positions.sort((a, b) => a[0] - b[0])[0] ?? [-1, 0]
  if (at < 0) return flat ? [{ text: flat.slice(0, AROUND), hit: false }] : []
  const start = Math.max(0, at - 30)
  return [
    { text: (start ? '…' : '') + flat.slice(start, at), hit: false },
    { text: flat.slice(at, at + length), hit: true },
    { text: flat.slice(at + length, start + AROUND), hit: false },
  ].filter((p) => p.text)
}

/** Every word must appear in the title, the tags or the text; title matches come first. */
export function searchNotes(vaults: { id: string; notes: NoteCardData[] }[], query: string): FoundNote[] {
  const want = words(query)
  if (!want.length) return []
  const found: (FoundNote & { score: number })[] = []
  for (const vault of vaults) {
    for (const note of vault.notes) {
      const { body } = toDoc('', note)
      const title = note.title.toLocaleLowerCase()
      const all = `${title} ${note.tags.join(' ')} ${body}`.toLocaleLowerCase()
      if (!want.every((w) => all.includes(w))) continue
      const score = want.filter((w) => title.includes(w)).length * 10 + (title.startsWith(want[0]!) ? 5 : 0)
      found.push({ vaultId: vault.id, noteId: note.id, title: note.title, snippet: cut(body, want), score })
    }
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map(({ score: _, ...note }) => note)
}

export async function searchAll(query: string, vaults: Vault[]): Promise<FoundNote[]> {
  if (!words(query).length) return []
  const backend = getVaultBackend()
  if (backend instanceof FileStore) {
    try {
      const hits = await searchIndex(query, LIMIT)
      // a deleted workspace may still be in the index for a moment
      return hits.flatMap((h) => {
        const vaultId = backend.vaultOfFolder(h.vault)
        return vaultId && vaults.some((v) => v.id === vaultId)
          ? [{ vaultId, noteId: h.id, title: h.title, snippet: parseSnippet(h.snippet) }]
          : []
      })
    } catch (e) {
      console.warn('search index:', e)
    }
  }
  return searchNotes(
    vaults.map((v) => ({ id: v.id, notes: backend.load(v.id).notes ?? [] })),
    query,
  )
}
