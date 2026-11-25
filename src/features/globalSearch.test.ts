import { describe, expect, it } from 'vitest'
import { parseSnippet, searchAll, searchNotes } from './globalSearch'
import type { NoteCardData } from '../types/note'

const note = (id: string, extra: Partial<NoteCardData> = {}): NoteCardData => ({ id, title: id, tags: [], x: 0, y: 0, width: 1, height: 1, ...extra })
const vaults = [
  { id: 'a', notes: [note('1', { title: 'Покупки', checklist: [{ id: 'c', label: 'молоко та хліб', done: false }] })] },
  { id: 'b', notes: [note('2', { title: 'Інше', body: `${'слово '.repeat(40)}МОЛОКО скінчилось`, tags: ['дім'] }), note('3', { title: 'Молоко' })] },
]

describe('search over every vault', () => {
  it('finds all words in any case, in any vault, titles first', () => {
    expect(searchNotes(vaults, 'молок').map((f) => `${f.vaultId}${f.noteId}`)).toEqual(['b3', 'a1', 'b2'])
    expect(searchNotes(vaults, 'молоко дім').map((f) => f.noteId)).toEqual(['2'])
    expect(searchNotes(vaults, 'молоко нема')).toEqual([])
    expect(searchNotes(vaults, '  — ')).toEqual([])
  })

  it('marks the match in a short piece of the text', () => {
    const { snippet } = searchNotes(vaults, 'молоко скінч')[0]
    expect(snippet.find((p) => p.hit)!.text).toBe('МОЛОКО')
    expect(snippet.map((p) => p.text).join('').length).toBeLessThan(100)
    expect(snippet[0].text.startsWith('…')).toBe(true)
  })

  it('reads the marks of the index', () => {
    expect(parseSnippet('до \u0002слово\u0003 після <b>')).toEqual([
      { text: 'до ', hit: false },
      { text: 'слово', hit: true },
      { text: ' після <b>', hit: false },
    ])
  })

  it('uses the notes in memory without vault folders', async () => {
    localStorage.setItem('aethel-vault:vault:b:notes', JSON.stringify(vaults[1].notes))
    const found = await searchAll('молоко', [{ id: 'b', name: 'B', createdAt: 0 }])
    expect(found.map((f) => f.noteId)).toEqual(['3', '2'])
  })
})
