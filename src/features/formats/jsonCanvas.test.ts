// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fromCanvas, toCanvas, type Board, type JsonCanvas } from './jsonCanvas'

const board: Board = {
  places: [
    { id: 'n1', x: 10, y: -20, width: 260, height: 160 },
    { id: 'n2', x: 400, y: 0, width: 300, height: 200 },
  ],
  connections: [
    { id: 'c1', from: 'n1', to: 'n2', fromSide: 'bottom', toSide: 'top' },
    { id: 'c2', from: 'n2', to: 'n1' },
  ],
  frames: [
    { id: 'f1', title: 'Рамка 🌿', x: 0, y: 0, width: 800, height: 500, color: 'default' },
    { id: 'f2', title: '', x: 0, y: 600, width: 800, height: 500, color: 'mint', locked: true },
  ],
  ink: [{ id: 's1', tool: 'pen', color: '#123456', points: [0.25, 1.5, 3, 4], x: 1.75, y: 2, note: 'n1' }],
  chips: [{ id: 't1', tag: 'ідея', x: 5.5, y: 6, color: 'accent', on: true, targets: ['n1'] }],
  view: { x: 145.82, y: -62.65, scale: 0.6 },
}
const fileOf = (id: string) => `${id}.md`
const idOf = (file: string) => (['n1.md', 'n2.md', 'n3.md'].includes(file) ? file.slice(0, -3) : undefined)
/** What really happens: the files are saved as JSON and read again. */
const disk = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('board ⇄ JSON Canvas + extra', () => {
  it('round-trips the whole board', () => {
    const out = toCanvas(board, { fileOf })
    const { owned, ...back } = fromCanvas(disk(out.canvas), disk(out.extra), idOf)
    expect(back).toStrictEqual(board)
    expect(owned!.sort()).toEqual(out.owned.sort())
  })

  it('writes only standard JSON Canvas fields, frames first', () => {
    const { canvas } = toCanvas(board, { fileOf, colorOf: (id) => (id === 'n1' ? 'yellow' : 'gray') })
    expect(canvas.nodes.map((n) => n.type)).toEqual(['group', 'group', 'file', 'file'])
    const allowed = ['id', 'type', 'x', 'y', 'width', 'height', 'color', 'file', 'label']
    for (const n of canvas.nodes) expect(Object.keys(n).filter((k) => !allowed.includes(k))).toEqual([])
    expect(canvas.nodes[2]).toMatchObject({ id: 'n1', file: 'n1.md', color: '3' })
    expect(canvas.nodes[3]).not.toHaveProperty('color')
    expect(canvas.edges[1]).toEqual({ id: 'c2', fromNode: 'n2', toNode: 'n1' })
  })

  it('rounds positions to whole pixels', () => {
    const dragged: Board = { ...board, places: [{ id: 'n1', x: 439.1025, y: 219.55, width: 260.4, height: 160 }] }
    expect(toCanvas(dragged, { fileOf }).canvas.nodes.at(-1)).toMatchObject({ x: 439, y: 220, width: 260, height: 160 })
  })

  it("keeps another app's cards, arrows and labels", () => {
    const first = toCanvas(board, { fileOf })
    const edited: JsonCanvas = disk(first.canvas)
    edited.nodes.push({ id: 'obs-text', type: 'text', text: 'з Obsidian', x: 1, y: 1, width: 100, height: 50 })
    edited.edges.push({ id: 'obs-edge', fromNode: 'obs-text', toNode: 'n1' })
    edited.edges[0].label = 'підпис стрілки'

    const loaded = fromCanvas(edited, first.extra, idOf)
    expect(loaded.places.map((p) => p.id)).toEqual(['n1', 'n2'])
    const second = toCanvas(loaded, { fileOf, previous: edited }).canvas
    expect(second.nodes.find((n) => n.id === 'obs-text')).toMatchObject({ text: 'з Obsidian' })
    expect(second.edges.find((e) => e.id === 'obs-edge')).toBeDefined()
    expect(second.edges.find((e) => e.id === 'c1')?.label).toBe('підпис стрілки')
  })

  it('does not duplicate a card added in another app, and lets Aether delete what it loaded', () => {
    const first = toCanvas(board, { fileOf })
    const edited: JsonCanvas = disk(first.canvas)
    edited.nodes.push({ id: 'random-7f', type: 'file', file: 'n3.md', x: 0, y: 0, width: 200, height: 100 })
    edited.edges.push({ id: 'obs-edge', fromNode: 'random-7f', toNode: 'n1' })

    const loaded = fromCanvas(edited, first.extra, idOf)
    expect(loaded.connections.at(-1)).toEqual({ id: 'obs-edge', from: 'n3', to: 'n1' })
    const same = toCanvas(loaded, { fileOf, previous: edited }).canvas
    expect(same.nodes.filter((n) => n.file === 'n3.md').map((n) => n.id)).toEqual(['random-7f'])
    expect(same.edges.find((e) => e.id === 'obs-edge')?.fromNode).toBe('random-7f')

    // the arrow and the card are deleted in Aether: they must not come back
    const deleted: Board = {
      ...loaded,
      places: loaded.places.filter((p) => p.id !== 'n3'),
      connections: loaded.connections.filter((c) => c.id !== 'obs-edge'),
    }
    const after = toCanvas(deleted, { fileOf, previous: edited }).canvas
    expect(after.nodes.some((n) => n.id === 'random-7f')).toBe(false)
    expect(after.edges.some((e) => e.id === 'obs-edge')).toBe(false)
  })

  it('keeps the card of a note whose file has not arrived yet', () => {
    const first = toCanvas(board, { fileOf })
    const partial = fromCanvas(first.canvas, first.extra, (f) => (f === 'n1.md' ? 'n1' : undefined))
    expect(partial.places.map((p) => p.id)).toEqual(['n1'])
    const written = toCanvas(partial, { fileOf, previous: first.canvas }).canvas
    expect(written.nodes.some((n) => n.file === 'n2.md')).toBe(true)
    expect(written.edges.map((e) => e.id)).toEqual(['c1', 'c2'])
  })

  it('follows a frame colour changed in another app and copes without the extra file', () => {
    const { canvas, extra } = toCanvas(board, { fileOf })
    const recoloured = disk(canvas)
    recoloured.nodes[1].color = '6'
    expect(fromCanvas(recoloured, extra, idOf).frames[1].color).toBe('lavender')
    const bare = fromCanvas(canvas, undefined, idOf)
    expect(bare.frames.map((f) => f.color)).toEqual(['default', 'mint'])
    expect(bare.ink).toEqual([])
    expect(fromCanvas({} as JsonCanvas, undefined, idOf).places).toEqual([])
  })
})
