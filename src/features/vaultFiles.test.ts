// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { VaultFiles } from './vaultFiles'
import { fakeDisk } from '../test/fakeVaultDisk'
import type { VaultSnapshot } from './vaultFs'
import type { VaultData } from './vaultRepo'
import type { NoteCardData } from '../types/note'

const empty: VaultSnapshot = { meta: '{}', notes: [], canvases: [], extras: {}, attachments: [], unreadable: [] }
const note = (id: string, title: string, extra: Partial<NoteCardData> = {}): NoteCardData => ({
  id,
  title,
  tags: [],
  x: 10,
  y: 20,
  width: 260,
  height: 160,
  ...extra,
})
const data = (notes: NoteCardData[], extra: Partial<VaultData> = {}): VaultData => ({
  notes,
  connections: [],
  frames: [],
  chips: [],
  ink: [],
  'canvas-transform': { x: 0, y: 0, scale: 1 },
  ...extra,
})
const open = (disk: ReturnType<typeof fakeDisk>) => VaultFiles.open('V', disk.snapshot(), disk.io)

describe('VaultFiles', () => {
  it('writes a new vault and reads back the same data', async () => {
    const disk = fakeDisk()
    const start = VaultFiles.open('V', empty, disk.io)
    const before = data([note('a', 'Перша', { body: 'текст' }), note('b', 'Перша', { image: { id: 'img-1' } })], {
      connections: [{ id: 'c', from: 'a', to: 'b' }],
      frames: [{ id: 'f', title: 'Р', x: 0, y: 0, width: 900, height: 600, color: 'cyan' }],
      chips: [{ id: 't', tag: 'x', x: 1, y: 2, color: 'accent' }],
      'canvas-transform': { x: 5.5, y: -1, scale: 0.7 },
    })
    start.files.attachmentAdded('img-1.png')
    await start.files.sync(before)
    expect([...disk.notes.keys()]).toEqual(['Перша.md', 'Перша 2.md'])
    expect(disk.notes.get('Перша 2.md')).toContain('![[attachments/img-1.png]]')
    expect(open(disk).data).toEqual(before)
  })

  it('writes nothing on opening, one file for one edit, and only the board for a move', async () => {
    const disk = fakeDisk()
    await VaultFiles.open('V', empty, disk.io).files.sync(data([note('a', 'A'), note('b', 'B')]))
    disk.log.length = 0
    const { files, data: loaded } = open(disk)
    await files.sync(loaded)
    expect(disk.log).toEqual([])

    const edited = data([{ ...loaded.notes[0], body: 'нове' }, loaded.notes[1]])
    await files.sync(edited)
    expect(disk.log).toEqual(['write A.md'])

    disk.log.length = 0
    await files.sync(data([{ ...edited.notes[0], x: 500 }, edited.notes[1]]))
    expect(disk.log).toEqual(['canvas V.canvas'])
  })

  it('renames the file with the title and moves deleted notes to the trash', async () => {
    const disk = fakeDisk()
    const { files } = VaultFiles.open('V', empty, disk.io)
    const a = note('a', 'Стара', { body: 'x' })
    await files.sync(data([a, note('b', 'B')]))
    await files.sync(data([{ ...a, title: 'Нова' }]))
    expect([...disk.notes.keys()]).toEqual(['Нова.md'])
    expect(disk.trash).toEqual(['B.md'])
    expect(JSON.parse(disk.boards.get('V.canvas')!.canvas).nodes.map((n: { file: string }) => n.file)).toEqual(['Нова.md'])
  })

  it('carries on after a failure at any step without losing or doubling a note', async () => {
    for (const op of ['write', 'rename', 'delete', 'canvas']) {
      const disk = fakeDisk()
      const { files } = VaultFiles.open('V', empty, disk.io)
      const a = note('a', 'A')
      await files.sync(data([a, note('b', 'B')]))
      const next = data([{ ...a, title: 'A2', body: 'нове' }, note('c', 'C')])
      disk.fail(op)
      await expect(files.sync(next), op).rejects.toThrow('disk full')
      disk.fail()
      await files.sync(next)
      expect([...disk.notes.keys()].sort(), op).toEqual(['A2.md', 'C.md'])
      expect(open(disk).data.notes, op).toEqual(next.notes)
    }
  })

  it("keeps another app's properties, shows its new notes and splits copied ids", async () => {
    const disk = fakeDisk()
    await VaultFiles.open('V', empty, disk.io).files.sync(data([note('a', 'A', { body: 'раз' })]))
    disk.notes.set('A.md', disk.notes.get('A.md')!.replace('---\n', '---\nrating: 5\n'))
    disk.notes.set('A копія.md', disk.notes.get('A.md')!)
    disk.notes.set('З Obsidian.md', 'привіт\n')

    const { files, data: loaded } = open(disk)
    expect(new Set(loaded.notes.map((n) => n.id)).size).toBe(3)
    const foreign = loaded.notes.find((n) => n.title === 'З Obsidian')!
    expect(foreign.y).toBeGreaterThan(180)
    await files.sync(data(loaded.notes.map((n) => (n.id === 'a' ? { ...n, body: 'два' } : n))))
    expect(disk.notes.get('A.md')).toContain('rating: 5')
    expect(disk.notes.get('З Obsidian.md')).toBe('привіт\n')
  })

  it('never touches a file it cannot understand', async () => {
    const disk = fakeDisk()
    disk.notes.set('Зламана.md', '---\na: [1\n---\n')
    const { files, data: loaded } = open(disk)
    expect(files.problems).toEqual(['Зламана.md'])
    expect(loaded.notes).toEqual([])
    await files.sync(data([note('n', 'Зламана')]))
    expect(disk.notes.get('Зламана.md')).toBe('---\na: [1\n---\n')
    expect(disk.notes.has('Зламана 2.md')).toBe(true)
  })

  it('refuses to open a vault whose board is broken or unreadable', () => {
    const disk = fakeDisk()
    disk.boards.set('V.canvas', { canvas: '{oops', extra: '{}' })
    expect(() => open(disk)).toThrow()
    expect(() => VaultFiles.open('V', { ...empty, unreadable: ['V.canvas'] }, disk.io)).toThrow('unreadable')
  })

  it('stays fast with 10 000 notes', async () => {
    const disk = fakeDisk()
    const many = Array.from({ length: 10_000 }, (_, i) => note(`n${i}`, `Нотатка ${i}`, { body: 'текст '.repeat(20) }))
    const { files } = VaultFiles.open('V', empty, { ...disk.io, noteFileName: async (_v, title) => `${title}.md` })
    await files.sync(data(many))
    const snap = disk.snapshot()
    let t = performance.now()
    const opened = VaultFiles.open('V', snap, disk.io)
    const openMs = performance.now() - t
    expect(opened.data.notes).toHaveLength(10_000)
    const changed = [...opened.data.notes]
    changed[500] = { ...changed[500], body: 'зміна' }
    disk.log.length = 0
    t = performance.now()
    await opened.files.sync(data(changed))
    const saveMs = performance.now() - t
    expect(disk.log.filter((l) => l.startsWith('write'))).toHaveLength(1)
    console.log(`10 000 notes: parse on open ${openMs.toFixed(0)} ms, save one change ${saveMs.toFixed(0)} ms`)
  }, 60_000)
})
