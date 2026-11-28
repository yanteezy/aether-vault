// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardText, legacyDir, moveLegacy, readLegacy } from './legacy.js'

/** A data folder as Aether 0.2.x left it. */
async function oldAether() {
  const appData = await mkdtemp(join(tmpdir(), 'legacy-'))
  const dir = join(appData, 'com.aethel.vault', 'data')
  await mkdir(join(dir, 'data'), { recursive: true })
  await mkdir(join(dir, 'images'))
  await writeFile(join(dir, 'aether-data.json'), '{"app":"aether"}')
  const key = async (k: string, v: unknown) => writeFile(join(dir, 'data', k.replace(/:/g, '%3A') + '.json'), JSON.stringify(v))
  await key('vaults', [{ id: 'v1', name: 'Робота' }, { id: 'v2', name: 'Дім' }])
  await key('active-vault', 'v2')
  await key('vault:v1:notes', [
    { id: 'n1', title: 'План', body: 'кроки', tags: ['робота'], x: 10.4, y: 20, width: 260, height: 160, style: 'banner', color: 'pink', image: { id: 'img1', fit: 'cover' } },
    { id: 'n2', title: 'Справи', tags: [], x: 400, y: 20, width: 260, height: 160, checklist: [{ id: 'c', label: 'купити', done: true }], locked: true, fontSize: 18 },
    { id: 'n3', title: 'Відео', tags: [], x: 0, y: 300, width: 300, height: 200, link: { url: 'https://youtu.be/x', kind: 'youtube' } },
  ])
  await key('vault:v1:connections', [{ id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n1', to: 'gone' }])
  await key('vault:v1:frames', [{ id: 'f1', title: 'Рамка', x: -20, y: -20, width: 800, height: 300, color: 'mint' }])
  await key('vault:v1:ink', [{ id: 's1', tool: 'pen', color: 'cyan', points: [0, 0, 10, 5], x: 100, y: 100 }, { id: 's2', tool: 'marker', color: '#ff0000', points: [0, 0, 4, 4], x: 1, y: 1, note: 'n2' }])
  await key('vault:v2:notes', [{ id: 'm1', title: 'Дім', tags: [], x: 0, y: 0, width: 200, height: 100 }])
  await writeFile(join(dir, 'images', 'img1.png'), 'PNG')
  return { appData, dir }
}

describe('notes from the old Aether', () => {
  it('finds the old data folder and its workspaces', async () => {
    const { appData, dir } = await oldAether()
    expect(await legacyDir(appData)).toBe(dir)
    expect(await legacyDir(join(appData, 'nothing'))).toBeNull()
    expect(await readLegacy(dir)).toEqual({ dir, active: 'v2', vaults: [{ id: 'v1', name: 'Робота', notes: 3 }, { id: 'v2', name: 'Дім', notes: 1 }] })
  })

  it('turns each workspace into a vault folder: cards, edges, frames, drawings, photos; the old folder is untouched', async () => {
    const { dir } = await oldAether()
    const before = await readdir(join(dir, 'data'))
    const out = await mkdtemp(join(tmpdir(), 'legacy-out-'))
    await mkdir(join(out, 'Робота')) // taken: the new vault goes next to it
    const moved = await moveLegacy(await readLegacy(dir), out)
    expect(moved.map((m) => m.name)).toEqual(['Дім', 'Робота']) // the active one first
    const work = moved[1]
    expect(work.path).toBe(join(out, 'Робота (2)'))
    const canvas = JSON.parse(await readFile(join(work.path, 'Полотно.canvas'), 'utf8'))
    const node = (id: string) => canvas.nodes.find((n: { id: string }) => n.id === id)
    expect(node('f1')).toMatchObject({ type: 'group', label: 'Рамка', color: '4' })
    expect(node('n1')).toMatchObject({ type: 'text', text: 'План\n\nкроки', x: 10, color: '#ff6fae', 'aether-style': 'banner', 'aether-tags': ['робота'], 'aether-image': { file: 'attachments/img1.png', fit: 'cover' } })
    expect(node('n2')).toMatchObject({ text: 'Справи\n\n- [x] купити', 'aether-locked': true, 'aether-fontSize': 18 })
    expect(node('n3')).toMatchObject({ type: 'link', url: 'https://youtu.be/x' })
    expect(canvas.edges).toEqual([{ id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'right', toSide: 'left' }])
    expect(await readFile(join(work.path, 'attachments', 'img1.png'), 'utf8')).toBe('PNG')
    const { strokes } = JSON.parse(await readFile(join(work.path, '.aether', 'canvas-extra', 'Полотно.canvas.json'), 'utf8'))
    expect(strokes[0]).toEqual({ id: 's1', points: [[100, 100], [110, 105]], width: 2.5, color: '#22d3ee' })
    expect(strokes[1].points[0]).toEqual([401, 21]) // drawn on note n2: moved by the note's place
    expect(strokes[1].color).toBe('#ff000059')
    expect(await readdir(join(dir, 'data'))).toEqual(before)
  })

  it('writes checklists and code as plain Markdown', () => {
    expect(cardText({ id: 'x', title: ' ', x: 0, y: 0, width: 1, height: 1, code: { language: 'ts', content: 'let a' } })).toBe('Без назви\n\n```ts\nlet a\n```')
  })
})
