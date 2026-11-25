import { describe, expect, it, vi } from 'vitest'
import { createIndexer, syncIndex, toDoc, type IndexIo, type IndexedVault } from './searchIndex'
import type { NoteCardData } from '../types/note'

const note = (id: string, extra: Partial<NoteCardData> = {}): NoteCardData => ({ id, title: id, tags: [], x: 0, y: 0, width: 1, height: 1, ...extra })
const vault = (n: number): IndexedVault => ({
  dir: 'V',
  notes: new Map(Array.from({ length: n }, (_, i) => [`${i}.md`, note(`n${i}`)])),
  connections: [{ id: 'c', from: 'n0', to: 'n1' }],
})
const fake = (stale: string[]) => {
  const calls: string[] = []
  const target: IndexIo = {
    keep: async (v) => void calls.push(`keep ${v}`),
    plan: async () => stale,
    put: async (_v, docs) => void calls.push(`put ${docs.length}`),
    links: async (_v, links) => void calls.push(`links ${JSON.stringify(links)}`),
  }
  return { calls, target }
}

describe('search index', () => {
  it('collects text, tags and wiki links, but no links from code', () => {
    const doc = toDoc(
      'A.md',
      note('a', {
        body: 'див. [[Перша]] і [[Друга|тут]] та ![[Третя#розділ]], знову [[Перша]] [[ ]]',
        checklist: [{ id: '1', label: 'пункт [[Четверта]]', done: false }],
        code: { language: 'js', content: 'x[[0]]' },
        link: { url: 'https://example.com', kind: 'web' },
        tags: ['t'],
      }),
    )
    expect(doc.links).toEqual(['Перша', 'Друга', 'Третя', 'Четверта'])
    expect(doc.body).toContain('x[[0]]')
    expect(doc.body).toContain('https://example.com')
    expect(doc.tags).toEqual(['t'])
  })

  it('sends only the changed files, in batches, and skips files without a note', async () => {
    const stale = [...Array.from({ length: 1200 }, (_, i) => `${i}.md`), 'unreadable.md']
    const { calls, target } = fake(stale)
    const progress = vi.fn()
    await syncIndex([vault(1500)], target, progress)
    expect(calls).toEqual(['keep V', 'put 500', 'put 500', 'put 200', 'links [["n0","n1"]]'])
    expect(progress).toHaveBeenLastCalledWith(1200, 1200)
  })

  it('runs once more for changes made during a run, and survives a failure', async () => {
    const { calls, target } = fake([])
    const indexer = createIndexer(() => [vault(2)], target)
    const first = indexer.run()
    void indexer.run()
    void indexer.run()
    await first
    expect(calls.filter((c) => c.startsWith('keep'))).toHaveLength(2)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = createIndexer(() => [vault(1)], { ...target, keep: async () => Promise.reject(new Error('no index')) })
    await expect(broken.run()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})
