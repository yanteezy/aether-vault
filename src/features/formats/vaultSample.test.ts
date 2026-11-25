// @vitest-environment node
/**
 * `tests/fixtures/vault-sample/` is a vault in the new format that can be opened in Obsidian. This test keeps
 * it equal to what the converters write. After an intended format change: `UPDATE_FIXTURES=1 npm test`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fromCanvas, toCanvas, type Board } from './jsonCanvas'
import { parseNote, serializeNote, type NoteContent } from './noteMarkdown'

const ROOT = fileURLToPath(new URL('../../../tests/fixtures/vault-sample/', import.meta.url))
const T = Date.UTC(2026, 0, 15, 12, 0, 0)

/** A small violet picture, so the photo note has something to show. */
function samplePng(width = 240, height = 120): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0
    for (const byte of b) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(body))
    return Buffer.concat([head, body, tail])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set([124, 92, 255], 1 + x * 3)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const notes: { stem: string; note: NoteContent }[] = [
  {
    stem: 'Ласкаво просимо',
    note: {
      id: 'n-welcome',
      title: 'Ласкаво просимо',
      tags: ['приклад'],
      color: 'purple',
      body: 'Це звичайний **Markdown** 👋\n\nПосилання на іншу нотатку: [[Список справ]]',
      updatedAt: T,
    },
  },
  {
    stem: 'Список справ',
    note: {
      id: 'n-todo',
      title: 'Список справ',
      tags: ['зробити'],
      color: 'yellow',
      checklist: [
        { id: 'i1', label: 'Відкрити папку в Obsidian', done: true },
        { id: 'i2', label: 'Відкрити полотно', done: false },
      ],
      updatedAt: T,
    },
  },
  {
    stem: 'Код',
    note: { id: 'n-code', title: 'Код', tags: [], body: 'Текст і код разом:', code: { language: 'ts', content: 'const answer = 42' }, updatedAt: T },
  },
  {
    stem: 'Фото',
    note: { id: 'n-photo', title: 'Фото', tags: [], body: 'Підпис під фото', image: { id: 'img-sample', fit: 'cover', w: 240, h: 120 }, updatedAt: T },
  },
  {
    stem: 'Посилання',
    note: { id: 'n-link', title: 'Посилання', tags: [], link: { url: 'https://jsoncanvas.org/', kind: 'web' }, updatedAt: T },
  },
  {
    stem: 'Що таке A-B',
    note: { id: 'n-title', title: 'Що таке A/B?', tags: [], body: 'У назві файлу не може бути «/» і «?», тому точна назва лежить у властивостях.', updatedAt: T },
  },
]

const place = (id: string, x: number, y: number, width = 320, height = 220) => ({ id, x, y, width, height })
const board: Board = {
  places: [
    place('n-welcome', 40, 80),
    place('n-todo', 420, 80),
    place('n-code', 40, 420),
    place('n-photo', 420, 420),
    place('n-link', 800, 80, 320, 140),
    place('n-title', 800, 420),
  ],
  connections: [{ id: 'c1', from: 'n-welcome', to: 'n-todo', fromSide: 'right', toSide: 'left' }],
  frames: [{ id: 'f1', title: 'Почніть тут', x: 0, y: 0, width: 780, height: 340, color: 'cyan' }],
  ink: [{ id: 's1', tool: 'pen', color: 'amber', points: [0, 0, 60, 20, 120, 0], x: 100, y: 700 }],
  chips: [{ id: 't1', tag: 'зробити', x: 800, y: 280, color: 'amber', targets: ['n-todo'] }],
  view: { x: 0, y: 0, scale: 0.8 },
}

const stemOf = (id: string) => notes.find((n) => n.note.id === id)!.stem
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

function build(): Record<string, string | Buffer> {
  const { canvas, extra } = toCanvas(board, {
    fileOf: (id) => `${stemOf(id)}.md`,
    colorOf: (id) => notes.find((n) => n.note.id === id)!.note.color,
  })
  return {
    '.aether/vault.json': json({ id: 'sample', name: 'Приклад', type: 'canvas', createdAt: T, views: [] }),
    '.aether/canvas-extra/Приклад.json': json(extra),
    'Приклад.canvas': json(canvas),
    'attachments/img-sample.png': samplePng(),
    ...Object.fromEntries(notes.map(({ stem, note }) => [`${stem}.md`, serializeNote(note, { stem, imageExt: 'png' })])),
  }
}

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')

describe('sample vault', () => {
  it('matches what the converters write', () => {
    for (const [path, content] of Object.entries(build())) {
      if (process.env.UPDATE_FIXTURES) {
        mkdirSync(dirname(join(ROOT, path)), { recursive: true })
        writeFileSync(join(ROOT, path), content)
      } else if (typeof content === 'string') expect(read(path), path).toBe(content)
      else expect(readFileSync(join(ROOT, path)).subarray(0, 8), path).toEqual(content.subarray(0, 8))
    }
  })

  it('reads back as the same notes and board', () => {
    for (const { stem, note } of notes) expect(parseNote(read(`${stem}.md`), stem, 'x'), stem).toStrictEqual(note)
    const { owned: _, ...back } = fromCanvas(
      JSON.parse(read('Приклад.canvas')),
      JSON.parse(read('.aether/canvas-extra/Приклад.json')),
      (file) => notes.find((n) => `${n.stem}.md` === file)?.note.id,
    )
    expect(back).toStrictEqual(board)
  })
})
