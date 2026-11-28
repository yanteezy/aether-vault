// @vitest-environment node
import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildGalaxy } from './build.js'
import { diskPosition, groupsOf } from '../../core/galaxy/layout.js'

let vault: string
const notes: Record<string, string> = {
  'Ідеї.md': '# Ідеї\nДив. [[План]] і [[Проєкти/Запуск|запуск]]. #робота',
  'План.md': '---\ntags: [робота]\n---\nКроки [[Ідеї]]',
  'Проєкти/Запуск.md': 'Старт #реліз ![[Ідеї]]',
  'Самотня.md': 'без посилань',
  '.trash/Видалена.md': '[[Ідеї]]',
}
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'galaxy-'))
  for (const [path, text] of Object.entries(notes)) {
    await mkdir(join(vault, path, '..'), { recursive: true })
    await writeFile(join(vault, path), text)
  }
})

describe('Galaxy builder', () => {
  it('finds notes, resolves [[links]] by path and by name, counts connections, skips hidden folders', async () => {
    const g = await buildGalaxy(vault)
    expect(g.paths).toEqual(['Ідеї.md', 'План.md', 'Проєкти/Запуск.md', 'Самотня.md'])
    const at = (p: string) => g.paths.indexOf(p)
    expect(g.degree[at('Ідеї.md')]).toBe(2) // План and Запуск (the embed back is the same pair)
    expect(g.degree[at('Самотня.md')]).toBe(0)
    expect(g.edges.length).toBe(4) // two undirected links
    expect(g.size[at('Ідеї.md')]).toBeGreaterThan(g.size[at('Самотня.md')])
    expect(g.positions.disk).toHaveLength(12)
    expect(g.color).toHaveLength(12)
  })

  it('lays notes out the same way on every run, from the note alone', async () => {
    const a = await buildGalaxy(vault)
    const b = await buildGalaxy(vault)
    expect([...b.positions.disk]).toEqual([...a.positions.disk])
    expect([...b.positions.folders]).toEqual([...a.positions.folders])
    const [x, y, z] = diskPosition('План.md', groupsOf('План.md', ['робота']))
    const i = a.paths.indexOf('План.md')
    expect([a.positions.disk[i * 3], a.positions.disk[i * 3 + 1], a.positions.disk[i * 3 + 2]]).toEqual([Math.fround(x), Math.fround(y), Math.fround(z)])
  })

  it('caches in .aether/galaxy-cache.json and re-reads only changed notes; notes stay untouched', async () => {
    const first = await buildGalaxy(vault)
    expect(first.stats.reparsed).toBe(4)
    const cache = JSON.parse(await readFile(join(vault, '.aether', 'galaxy-cache.json'), 'utf8'))
    expect(Object.keys(cache.notes).sort()).toEqual(['Ідеї.md', 'План.md', 'Проєкти/Запуск.md', 'Самотня.md'])
    expect(cache.notes['План.md'].pos).toHaveLength(9)

    expect((await buildGalaxy(vault)).stats.reparsed).toBe(0)

    await writeFile(join(vault, 'Самотня.md'), 'тепер з [[План]]')
    const later = new Date(Date.now() + 5000)
    await utimes(join(vault, 'Самотня.md'), later, later)
    const third = await buildGalaxy(vault)
    expect(third.stats.reparsed).toBe(1)
    expect(third.degree[third.paths.indexOf('Самотня.md')]).toBe(1)

    for (const [path, text] of Object.entries(notes)) if (path !== 'Самотня.md') expect(await readFile(join(vault, path), 'utf8')).toBe(text)
  })

  it('labels the biggest groups in each layout', async () => {
    const g = await buildGalaxy(vault)
    expect(g.labels.tags.map((l) => l.text)).toContain('#робота')
    expect(g.labels.folders.map((l) => l.text)).toEqual(['Проєкти'])
  })

  it('turns the text cards of a canvas into stars, linked by arrows and [[links]], without new files', async () => {
    const canvas = {
      nodes: [
        { id: 'a', type: 'text', text: '## Мета\nдив. [[План]] #ціль', x: 0, y: 0, width: 200, height: 80 },
        { id: 'b', type: 'text', text: 'Друга', x: 300, y: 0, width: 200, height: 80 },
        { id: 'f', type: 'file', file: 'Самотня.md', x: 0, y: 200, width: 200, height: 80 },
        { id: 'g', type: 'group', label: 'Рамка', x: -20, y: -20, width: 600, height: 400 },
      ],
      edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'b', toNode: 'f' }],
    }
    const text = JSON.stringify(canvas)
    await writeFile(join(vault, 'Дошка.canvas'), text)
    const g = await buildGalaxy(vault)
    expect(g.count).toBe(6) // 4 notes + 2 text cards (file cards and groups are not stars)
    const a = g.paths.indexOf('Дошка.canvas#a'), b = g.paths.indexOf('Дошка.canvas#b')
    expect([g.kind[a], g.kind[b], g.kind[g.paths.indexOf('План.md')]]).toEqual([1, 1, 0])
    expect(g.names[a]).toBe('Мета')
    expect(g.degree[a]).toBe(2) // card b (arrow) and План (link)
    expect(g.degree[b]).toBe(2) // card a, and Самотня through the file card
    expect(g.degree[g.paths.indexOf('Самотня.md')]).toBe(1)
    expect(g.labels.tags.map((l) => l.text)).toContain('#ціль')
    expect(await readFile(join(vault, 'Дошка.canvas'), 'utf8')).toBe(text)

    expect((await buildGalaxy(vault)).stats.reparsed).toBe(0) // the canvas is cached too
    await writeFile(join(vault, 'Дошка.canvas'), '{ broken')
    const later = new Date(Date.now() + 5000)
    await utimes(join(vault, 'Дошка.canvas'), later, later)
    expect((await buildGalaxy(vault)).count).toBe(4) // unreadable canvas: no cards, nothing fails
  })
})
