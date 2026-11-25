// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseNote, serializeNote, type NoteContent } from './noteMarkdown'

const roundTrip = (note: NoteContent, stem = note.title) =>
  parseNote(serializeNote(note, { stem, imageExt: 'jpg' }), stem, 'fallback')

const base: NoteContent = { id: 'n1', title: 'Нотатка', tags: [] }

describe('note ⇄ Markdown', () => {
  it('keeps a plain note readable, without markers', () => {
    const note: NoteContent = { ...base, tags: ['ідея'], body: 'Привіт 👋\n\nДругий абзац', updatedAt: 1700000000123 }
    const text = serializeNote(note, { stem: 'Нотатка' })
    expect(text).not.toContain('%% aether')
    expect(text).toContain('aether-id: n1')
    expect(text).not.toContain('aether-title')
    expect(text.endsWith('---\nПривіт 👋\n\nДругий абзац\n')).toBe(true)
    expect(roundTrip(note)).toStrictEqual(note)
  })

  it('writes a pure checklist and pure code as ordinary Markdown', () => {
    const list: NoteContent = {
      ...base,
      checklist: [
        { id: 'a', label: 'купити 🥛', done: true },
        { id: 'b', label: '', done: false },
      ],
    }
    const code: NoteContent = { ...base, code: { language: 'ts', content: 'const x = 1\n' } }
    for (const n of [list, code]) {
      expect(serializeNote(n, { stem: n.title })).not.toContain('%% aether')
      expect(roundTrip(n)).toStrictEqual(n)
    }
  })

  const bodies = [
    undefined,
    '',
    'текст',
    'кінець із порожнім рядком\n',
    '\nпочаток із порожнім рядком',
    '---\nне frontmatter\n---',
    '- [ ] це набрано в тексті',
    '```js\nце теж текст\n```',
    '%% aether:code %%\n\\%% aether:body %%',
    'юнікод ǅ 𝔄 👨‍👩‍👧 ‮',
  ]
  const checklists = [undefined, [], [{ id: 'c1', label: '%% aether:code %%', done: false }]]
  const codes = [undefined, { language: '', content: '' }, { language: 'md', content: '````\n```\n%% aether:body %%\n- [x] ні\n---' }]

  it('round-trips every mix of text, checklist and code', () => {
    let count = 0
    for (const body of bodies)
      for (const checklist of checklists)
        for (const code of codes) {
          const note: NoteContent = { ...base }
          if (body !== undefined) note.body = body
          if (checklist) note.checklist = checklist
          if (code) note.code = code
          expect(roundTrip(note), JSON.stringify(note)).toStrictEqual(note)
          count++
        }
    expect(count).toBe(90)
  })

  it('round-trips every property, a photo and a link card', () => {
    const note: NoteContent = {
      ...base,
      tags: ['a', 'два слова', '#3', 'true'],
      body: 'підпис',
      color: 'pink',
      style: 'quote',
      locked: false,
      titleAlign: 'center',
      fontSize: 'auto',
      font: 'serif',
      image: { id: 'img-abc', fit: 'contain', x: 1.5, y: -2, zoom: 2, dim: 0.3, w: 800, h: 600 },
      link: { url: 'https://youtu.be/abc?t=1#x', kind: 'youtube', thumb: 'https://i.ytimg.com/vi/abc/hq.jpg' },
      updatedAt: 0,
    }
    const text = serializeNote(note, { stem: note.title, imageExt: 'png' })
    expect(text).toContain('---\n![[attachments/img-abc.png]]\nhttps://youtu.be/abc?t=1#x\nпідпис\n')
    expect(text).toContain('aether-kind: link')
    expect(parseNote(text, note.title, 'x')).toStrictEqual(note)
    expect(roundTrip({ ...base, fontSize: 18 })).toStrictEqual({ ...base, fontSize: 18 })
  })

  it('keeps titles a file name cannot hold, and follows a rename made in Obsidian', () => {
    for (const title of ['', 'A/B: що?', 'CON', 'д'.repeat(500), 'крапка в кінці.', 'a: "b" # c'])
      expect(roundTrip({ ...base, title }, 'Файл').title).toBe(title)
    const text = serializeNote({ ...base, title: 'A/B' }, { stem: 'A-B' })
    expect(parseNote(text, 'Нова назва', 'x').title).toBe('Нова назва')
  })

  it('keeps foreign properties and comments when rewriting a file', () => {
    const mine = '---\n# мій коментар\naliases:\n  - друге імʼя\ncolor: "#ff0000"\nupdated: колись\nrating: 5\n---\nстарий текст\n'
    const note = parseNote(mine, 'Чужа', 'new-id')
    expect(note).toStrictEqual({ id: 'new-id', title: 'Чужа', tags: [], body: 'старий текст' })
    const out = serializeNote({ ...note, body: 'новий' }, { stem: 'Чужа', previous: mine })
    for (const kept of ['# мій коментар', '- друге імʼя', 'color: "#ff0000"', 'updated: колись', 'rating: 5'])
      expect(out).toContain(kept)
    expect(out).toContain('aether-id: new-id')
    expect(out.endsWith('---\nновий\n')).toBe(true)
  })

  it('removes an Aether property that was cleared', () => {
    const first = serializeNote({ ...base, color: 'blue', locked: true, tags: ['t'] }, { stem: base.title })
    const second = serializeNote(base, { stem: base.title, previous: first })
    expect(parseNote(second, base.title, 'x')).toStrictEqual(base)
    expect(second).not.toMatch(/color|locked|tags/)
  })

  it('reads files written by other editors', () => {
    expect(parseNote('просто файл', 'S', 'i')).toStrictEqual({ id: 'i', title: 'S', tags: [], body: 'просто файл' })
    expect(parseNote('﻿---\r\ntags: a, b\r\n---\r\nрядок\r\n', 'S', 'i')).toStrictEqual({ id: 'i', title: 'S', tags: ['a', 'b'], body: 'рядок' })
    expect(parseNote('', 'S', 'i')).toStrictEqual({ id: 'i', title: 'S', tags: [] })
    expect(parseNote('---\n---\n', 'S', 'i')).toStrictEqual({ id: 'i', title: 'S', tags: [] })
  })

  it('does not lose text typed after an Aether block', () => {
    const text = serializeNote({ ...base, body: 'текст', code: { language: 'js', content: '1' } }, { stem: base.title })
    const read = parseNote(text + 'дописано в Obsidian\n', base.title, 'x')
    expect(read.body).toContain('дописано в Obsidian')
    expect(read.body).toContain('текст')
  })

  it('refuses to read or overwrite broken frontmatter', () => {
    const broken = '---\na: [1\n---\nтекст\n'
    expect(() => parseNote(broken, 'S', 'i')).toThrow('bad-frontmatter')
    expect(() => serializeNote(base, { stem: 'S', previous: broken })).toThrow('bad-frontmatter')
    expect(() => serializeNote({ ...base, image: { id: 'img-a' } }, { stem: 'S' })).toThrow('image-ext-missing')
  })
})
