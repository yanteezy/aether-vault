// @vitest-environment jsdom
/** «Галактика» overlay: card, keyboard navigation, dock chips and the screen-reader list. */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { GalaxyData } from '../../core/galaxy/types.js'
import { GalaxyOverlay, agoText, type OverlayHandlers, type Projector } from './overlay.js'

// screen positions (x, y): 0 centre, 1 right, 2 below, 3 far right, 4 far below
const XY = [[100, 100], [200, 100], [100, 200], [300, 110], [110, 300]]
const names = ['Агенти', 'Пам’ять', 'Графи', 'Хмара', 'Самотня']
const project: Projector = (x, y) => ({ x, y, visible: true })

function makeData(): GalaxyData {
  const pos = new Float32Array(XY.flatMap(([x, y]) => [x, y, 0]))
  return {
    count: 5, paths: names.map((n) => n + '.md'), kind: new Uint8Array(5), names,
    positions: { disk: pos, folders: pos, tags: pos },
    size: new Float32Array(5), brightness: new Float32Array(5), color: new Float32Array(15),
    edges: new Uint32Array([0, 1, 0, 2, 0, 3]), degree: new Uint16Array([3, 1, 1, 1, 0]),
    mtime: new Float64Array(5).fill(Date.now() - 864e5 - 3600e3),
    labels: { disk: [{ text: 'Ідеї', x: 100, y: 100, z: 0, color: '#fff' }, { text: 'Інше', x: 300, y: 300, z: 0, color: '#aaa' }], folders: [], tags: [] },
    stats: { ms: 1, reparsed: 0, cached: true },
  }
}
const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k })
const btn = (o: GalaxyOverlay, text: string): HTMLButtonElement =>
  [...o.el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

let o: GalaxyOverlay
let hd: { [K in keyof OverlayHandlers]: Mock<OverlayHandlers[K]> }

beforeEach(() => {
  document.body.textContent = ''
  const host = document.body.appendChild(document.createElement('div'))
  hd = { onLayout: vi.fn(), onPreset: vi.fn(), onReset: vi.fn(), onZoom: vi.fn(), onOpen: vi.fn(), onSelect: vi.fn(), onFocus: vi.fn() } as typeof hd
  o = new GalaxyOverlay(host, hd)
  o.setData(makeData(), 'disk')
})

describe('GalaxyOverlay', () => {
  it('shows the card with name, link count and age for the selected star', () => {
    o.setSelected(0)
    const card = o.el.querySelector('.gx-card') as HTMLElement
    expect(card.hidden).toBe(false)
    expect(card.textContent).toContain('Агенти')
    expect(card.textContent).toContain('3 зв’язки')
    expect(card.textContent).toContain('вчора')
    expect(card.textContent).toContain('Нотатка · Ідеї')
    expect(o.el.querySelector('.gx-live')?.textContent).toBe('Вибрано: Агенти, 3 зв’язки')
    o.setSelected(-1)
    expect(card.hidden).toBe(true)
  })

  it('Enter opens the selected note', () => {
    o.setSelected(0)
    expect(o.handleKey(key('Enter'), project)).toBe(true)
    expect(hd.onOpen).toHaveBeenCalledWith(0)
  })

  it('arrows move the selection to the nearest star in that direction', () => {
    o.setSelected(0)
    o.handleKey(key('ArrowRight'), project)
    expect(hd.onSelect).toHaveBeenLastCalledWith(1)
    o.setSelected(0)
    o.handleKey(key('ArrowDown'), project)
    expect(hd.onSelect).toHaveBeenLastCalledWith(2)
    hd.onSelect.mockClear()
    o.setSelected(0)
    o.handleKey(key('ArrowLeft'), project) // nothing to the left
    expect(hd.onSelect).not.toHaveBeenCalled()
  })

  it('F toggles focus; Escape leaves focus first, then clears the selection', () => {
    o.setSelected(0)
    o.handleKey(key('f'), project)
    expect(hd.onFocus).toHaveBeenLastCalledWith(0)
    const panel = o.el.querySelector('.gx-panel') as HTMLElement
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('3 зв’язані нотатки')
    o.handleKey(key('Escape'), project)
    expect(hd.onFocus).toHaveBeenLastCalledWith(-1)
    expect(hd.onSelect).not.toHaveBeenCalled()
    expect(panel.hidden).toBe(true)
    o.handleKey(key('Escape'), project)
    expect(hd.onSelect).toHaveBeenLastCalledWith(-1)
    expect(o.handleKey(key('Escape'), project)).toBe(false)
  })

  it('dock chips call handlers and update aria-pressed', () => {
    expect(btn(o, 'Диском').getAttribute('aria-pressed')).toBe('true')
    btn(o, 'Папками').click()
    expect(hd.onLayout).toHaveBeenCalledWith('folders')
    expect(btn(o, 'Папками').getAttribute('aria-pressed')).toBe('true')
    expect(btn(o, 'Диском').getAttribute('aria-pressed')).toBe('false')
    btn(o, 'Зверху').click()
    expect(hd.onPreset).toHaveBeenCalledWith('top')
    expect(btn(o, 'Зверху').getAttribute('aria-pressed')).toBe('true')
    o.setPreset(null)
    expect(btn(o, 'Зверху').getAttribute('aria-pressed')).toBe('false')
    btn(o, '+').click()
    expect(hd.onZoom).toHaveBeenLastCalledWith(1.25)
    btn(o, 'Скинути').click()
    expect(hd.onReset).toHaveBeenCalled()
  })

  it('lists notes for screen readers; activating one selects it', () => {
    const list = o.el.querySelector('ul[aria-label="Нотатки галактики"]') as HTMLElement
    const items = [...list.querySelectorAll('button')]
    expect(items).toHaveLength(5)
    expect(items[0].textContent).toContain('Агенти')
    items.find((b) => b.textContent?.startsWith('Хмара'))!.click()
    expect(hd.onSelect).toHaveBeenCalledWith(3)
  })

  it('frame positions the card and labels without throwing', () => {
    o.setSelected(0)
    o.setHover(1)
    o.frame(project)
    expect((o.el.querySelector('.gx-card') as HTMLElement).style.transform).toContain('translate3d')
    expect(o.el.querySelectorAll('.gx-label')).toHaveLength(2)
  })

  it('formats relative time', () => {
    const now = new Date(2026, 5, 10, 12).getTime()
    expect(agoText(now - 3600e3, now)).toBe('сьогодні')
    expect(agoText(now - 864e5, now)).toBe('вчора')
    expect(agoText(now - 5 * 864e5, now)).toBe('5 днів тому')
    expect(agoText(now - 22 * 864e5, now)).toBe('22 дні тому')
  })
})
