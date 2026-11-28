/**
 * «Галактика»: the DOM layer over the WebGL canvas — dock, group labels, hover tooltip, note card, focus panel,
 * a screen-reader list of notes and a live region. Styles: src/styles/galaxy.css.
 * frame() runs every rendered frame, so it only writes transforms of a handful of pre-built elements.
 */
import type { GalaxyData, GalaxyLayout } from '../../core/galaxy/types.js'

export type Preset = 'top' | 'oblique' | 'edge'
export interface OverlayHandlers {
  onLayout(l: GalaxyLayout): void
  onPreset(p: Preset): void
  onReset(): void
  onZoom(factor: number): void
  onOpen(i: number): void
  onSelect(i: number): void
  onFocus(i: number): void
}
export type Projector = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean }

const LAYOUTS: [GalaxyLayout, string][] = [['disk', 'Диском'], ['folders', 'Папками'], ['tags', 'Тегами']]
const PRESETS: [Preset, string][] = [['top', 'Зверху'], ['oblique', 'Під кутом'], ['edge', 'З ребра']]
const MAX_LIST = 500
const MAX_LINKED = 50
const MAX_LABELS = 80
const CARD_W = 268
const DIRS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text) el.textContent = text
  for (const k in attrs) el.setAttribute(k, attrs[k])
  return el
}

/** Ukrainian plural form for n. */
function pl(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
export const linksText = (n: number): string => `${n} ${pl(n, 'зв’язок', 'зв’язки', 'зв’язків')}`
const linkedText = (n: number): string => `${n} ${pl(n, 'зв’язана нотатка', 'зв’язані нотатки', 'зв’язаних нотаток')}`

export function agoText(mtime: number, now = Date.now()): string {
  const day = (t: number): number => { const d = new Date(t); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5) }
  const n = day(now) - day(mtime)
  if (n <= 0) return 'сьогодні'
  if (n === 1) return 'вчора'
  return `${n} ${pl(n, 'день', 'дні', 'днів')} тому`
}

/** A positioned element that remembers what was last written, so a still frame costs no DOM writes. */
class Slot {
  vis = false
  t = ''
  constructor(readonly el: HTMLElement, private suffix = '') { el.style.visibility = 'hidden' }
  put(x: number, y: number, vis: boolean): void {
    if (vis !== this.vis) { this.el.style.visibility = vis ? 'visible' : 'hidden'; this.vis = vis }
    if (!vis) return
    const t = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)${this.suffix}`
    if (t !== this.t) { this.el.style.transform = t; this.t = t }
  }
}

export class GalaxyOverlay {
  readonly el: HTMLElement
  private data: GalaxyData | null = null
  private layout: GalaxyLayout = 'disk'
  private sel = -1
  private hov = -1
  private foc = -1
  private w = 0
  private hgt = 0
  private cardH = 150
  private ro: ResizeObserver | null = null

  private labels = h('div', 'gx-labels', '', { 'aria-hidden': 'true' })
  private labelSlots: Slot[] = []
  private tip = h('div', 'gx-tip', '', { 'aria-hidden': 'true' })
  private tipSlot = new Slot(this.tip, 'translate(-50%,-100%)')
  private selRing = h('div', 'gx-ring', '', { 'aria-hidden': 'true' })
  private selRingSlot = new Slot(this.selRing, 'translate(-50%,-50%)')
  private focRing = h('div', 'gx-ring gx-ring-focus', '', { 'aria-hidden': 'true' })
  private focRingSlot = new Slot(this.focRing, 'translate(-50%,-50%)')

  private card = h('div', 'gx-glass gx-card', '', { role: 'region', 'aria-label': 'Нотатка' })
  private cardSlot = new Slot(this.card)
  private cardKind = h('span', 'gx-kind')
  private cardTitle = h('span', 'gx-title')
  private cardMeta = h('span', 'gx-meta')
  private cardOpen = h('button', 'gx-btn gx-btn-primary', 'Відкрити · Enter', { type: 'button' })

  private panel = h('div', 'gx-glass gx-panel', '', { role: 'region', 'aria-label': 'Фокус' })
  private panelTitle = h('span', 'gx-title')
  private panelMeta = h('span', 'gx-meta')
  private panelList = h('ul', 'gx-linked')

  private sr = h('div', 'gx-sr')
  private srList = h('ul', 'gx-sr-list', '', { 'aria-label': 'Нотатки галактики' })
  private live = h('div', 'gx-live', '', { role: 'status', 'aria-live': 'polite' })

  private layoutBtns = new Map<GalaxyLayout, HTMLButtonElement>()
  private presetBtns = new Map<Preset, HTMLButtonElement>()
  private zoomEl = h('span', 'gx-zoom', '100%')

  constructor(private host: HTMLElement, private hd: OverlayHandlers) {
    this.el = h('div', 'galaxy-overlay')
    this.cardSlot.el.hidden = true
    this.panel.hidden = true
    this.cardOpen.addEventListener('click', () => { if (this.sel >= 0) hd.onOpen(this.sel) })
    this.card.append(this.cardKind, this.cardTitle, this.cardMeta, this.cardOpen)

    const exit = h('button', 'gx-btn gx-btn-ghost', 'Вийти з фокусу · Esc', { type: 'button' })
    exit.addEventListener('click', () => this.leaveFocus())
    this.panel.append(h('span', 'gx-kind', 'Фокус'), this.panelTitle, this.panelMeta, this.panelList, exit)

    this.sr.append(this.srList)
    this.el.append(this.sr, this.labels, this.selRing, this.focRing, this.tip, this.card, this.panel, this.buildDock(), this.live)
    host.appendChild(this.el)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.measure())
      this.ro.observe(host)
    }
    this.measure()
    this.setLayout('disk')
    this.setPreset(null)
  }

  private buildDock(): HTMLElement {
    const dock = h('div', 'gx-glass gx-dock', '', { role: 'toolbar', 'aria-label': 'Керування Галактикою' })
    const chips = <T extends string>(label: string, items: [T, string][], map: Map<T, HTMLButtonElement>, on: (v: T) => void): HTMLElement => {
      const g = h('div', 'gx-group', '', { role: 'group', 'aria-label': label })
      g.append(h('span', 'gx-dock-label', label))
      for (const [v, text] of items) {
        const b = h('button', 'gx-chip', text, { type: 'button', 'aria-pressed': 'false' })
        b.addEventListener('click', () => on(v))
        map.set(v, b)
        g.append(b)
      }
      return g
    }
    const btn = (text: string, label: string, cls: string, on: () => void): HTMLButtonElement => {
      const b = h('button', cls, text, { type: 'button', 'aria-label': label })
      b.addEventListener('click', on)
      return b
    }
    dock.append(
      chips('Ракурс', PRESETS, this.presetBtns, (p) => { this.setPreset(p); this.hd.onPreset(p) }),
      chips('Групувати', LAYOUTS, this.layoutBtns, (l) => { this.setLayout(l); this.hd.onLayout(l) }),
      h('span', 'gx-sep', '', { 'aria-hidden': 'true' }),
      btn('Скинути', 'Скинути вигляд', 'gx-tool gx-tool-text', () => this.hd.onReset()),
      btn('−', 'Зменшити', 'gx-tool', () => this.hd.onZoom(1 / 1.25)),
      this.zoomEl,
      btn('+', 'Збільшити', 'gx-tool', () => this.hd.onZoom(1.25)),
    )
    return dock
  }

  private measure(): void { this.w = this.host.clientWidth; this.hgt = this.host.clientHeight }

  setData(data: GalaxyData, layout: GalaxyLayout): void {
    this.data = data
    this.layout = layout
    this.sel = this.hov = this.foc = -1
    this.cardSlot.put(0, 0, false); this.card.hidden = true
    this.panel.hidden = true
    this.selRingSlot.put(0, 0, false); this.focRingSlot.put(0, 0, false); this.tipSlot.put(0, 0, false)
    this.syncLayoutChips()
    this.rebuildLabels()
    this.rebuildList()
  }

  setLayout(l: GalaxyLayout): void {
    if (l === this.layout && this.layoutBtns.get(l)?.getAttribute('aria-pressed') === 'true') return
    this.layout = l
    this.syncLayoutChips()
    this.rebuildLabels()
    this.rebuildList()
  }

  setPreset(p: Preset | null): void {
    for (const [k, b] of this.presetBtns) b.setAttribute('aria-pressed', String(k === p))
  }

  setZoomLabel(pct: number): void { this.zoomEl.textContent = `${Math.round(pct)}%` }

  private syncLayoutChips(): void {
    for (const [k, b] of this.layoutBtns) b.setAttribute('aria-pressed', String(k === this.layout))
  }

  private rebuildLabels(): void {
    this.labels.textContent = ''
    this.labelSlots = []
    for (const l of (this.data?.labels[this.layout] ?? []).slice(0, MAX_LABELS)) {
      const el = h('span', 'gx-label', l.text)
      el.style.setProperty('--c', l.color)
      this.labels.append(el)
      this.labelSlots.push(new Slot(el, 'translate(-50%,-50%)'))
    }
  }

  /** Name of the group centre nearest to star i in the current layout ('' if the layout has none). */
  private groupOf(i: number): string {
    const d = this.data
    if (!d) return ''
    const pos = d.positions[this.layout]
    let best = '', bd = Infinity
    for (const l of d.labels[this.layout]) {
      const dx = pos[3 * i] - l.x, dy = pos[3 * i + 1] - l.y, dz = pos[3 * i + 2] - l.z
      const dist = dx * dx + dy * dy + dz * dz
      if (dist < bd) { bd = dist; best = l.text }
    }
    return best
  }

  private rebuildList(): void {
    const d = this.data
    this.srList.textContent = ''
    this.sr.querySelector('p')?.remove()
    if (!d) return
    const order = Array.from({ length: d.count }, (_, i) => i).sort((a, b) => d.degree[b] - d.degree[a]).slice(0, MAX_LIST)
    const groups = new Map<string, number[]>()
    for (const i of order) {
      const g = this.groupOf(i)
      const arr = groups.get(g)
      if (arr) arr.push(i); else groups.set(g, [i])
    }
    for (const [g, ids] of groups) {
      const li = h('li')
      const ul = h('ul')
      if (g) li.append(h('span', 'gx-sr-group', g))
      for (const i of ids) {
        const b = h('button', 'gx-sr-item', `${d.names[i]}, ${linksText(d.degree[i])}`, { type: 'button' })
        b.addEventListener('click', () => this.pick(i))
        const item = h('li'); item.append(b); ul.append(item)
      }
      li.append(ul)
      this.srList.append(li)
    }
    if (d.count > MAX_LIST) {
      this.sr.append(h('p', 'gx-sr-note', `Показано ${MAX_LIST} найбільш зв’язаних нотаток із ${d.count}; ще ${d.count - MAX_LIST} не показано.`))
    }
  }

  private pick(i: number): void { this.hd.onSelect(i); this.setSelected(i) }

  setHover(i: number): void {
    this.hov = i
    const name = this.data && i >= 0 ? this.data.names[i] : ''
    this.tip.textContent = name
    if (i < 0) this.tipSlot.put(0, 0, false)
  }

  setSelected(i: number): void {
    const d = this.data
    if (!d) return
    if (i >= d.count) i = -1
    if (i === this.sel) return
    this.sel = i
    if (i < 0) {
      this.card.hidden = true
      this.cardSlot.put(0, 0, false)
      this.selRingSlot.put(0, 0, false)
      return
    }
    const kind = d.kind?.[i] === 1 ? 'Картка' : 'Нотатка'
    this.cardKind.textContent = [kind, this.groupOf(i)].filter(Boolean).join(' · ')
    this.cardTitle.textContent = d.names[i]
    this.cardMeta.textContent = `${linksText(d.degree[i])} · змінено ${agoText(d.mtime[i])}`
    this.card.setAttribute('aria-label', `${kind}: ${d.names[i]}`)
    this.card.hidden = false
    this.cardH = this.card.offsetHeight || 150
    this.live.textContent = `Вибрано: ${d.names[i]}, ${linksText(d.degree[i])}`
  }

  setFocus(i: number, linked: number[]): void {
    const d = this.data
    this.foc = d && i >= 0 && i < d.count ? i : -1
    this.panelList.textContent = ''
    if (!d || this.foc < 0) {
      this.panel.hidden = true
      this.focRingSlot.put(0, 0, false)
      return
    }
    const sorted = [...linked].sort((a, b) => d.degree[b] - d.degree[a])
    this.panelTitle.textContent = d.names[this.foc]
    this.panelMeta.textContent = `${linkedText(linked.length)} · решта приглушені`
    for (const j of sorted.slice(0, MAX_LINKED)) {
      const b = h('button', 'gx-btn gx-linked-btn', d.names[j], { type: 'button' })
      b.addEventListener('click', () => this.pick(j))
      const item = h('li'); item.append(b); this.panelList.append(item)
    }
    if (sorted.length > MAX_LINKED) this.panelList.append(h('li', 'gx-more', `…і ще ${sorted.length - MAX_LINKED}`))
    this.panel.hidden = false
    this.live.textContent = `Фокус: ${d.names[this.foc]}, ${linkedText(linked.length)}`
  }

  private neighbours(i: number): number[] {
    const e = this.data!.edges
    const out: number[] = []
    for (let k = 0; k < e.length; k += 2) {
      if (e[k] === i) out.push(e[k + 1]); else if (e[k + 1] === i) out.push(e[k])
    }
    return out
  }

  private leaveFocus(): void { this.hd.onFocus(-1); this.setFocus(-1, []) }

  frame(project: Projector): void {
    const d = this.data
    if (!d) return
    const pos = d.positions[this.layout]
    const ls = d.labels[this.layout]
    for (let k = 0; k < this.labelSlots.length; k++) {
      const p = project(ls[k].x, ls[k].y, ls[k].z)
      this.labelSlots[k].put(p.x, p.y, p.visible)
    }
    const at = (i: number) => project(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2])
    if (this.sel >= 0) {
      const p = at(this.sel)
      this.selRingSlot.put(p.x, p.y, p.visible)
      let x = p.x + 24, y = p.y - 60
      if (this.w > 0) {
        if (x + CARD_W > this.w - 12) x = p.x - 24 - CARD_W
        x = Math.max(12, x)
        y = Math.max(72, Math.min(y, this.hgt - this.cardH - 84))
      }
      this.cardSlot.put(x, y, p.visible)
    }
    if (this.foc >= 0 && this.foc !== this.sel) {
      const p = at(this.foc)
      this.focRingSlot.put(p.x, p.y, p.visible)
    } else this.focRingSlot.put(0, 0, false)
    if (this.hov >= 0 && this.hov !== this.sel) {
      const p = at(this.hov)
      this.tipSlot.put(p.x, p.y - 12, p.visible)
    } else this.tipSlot.put(0, 0, false)
  }

  handleKey(e: KeyboardEvent, project: Projector): boolean {
    const d = this.data
    if (!d || e.ctrlKey || e.altKey || e.metaKey) return false
    const t = e.target instanceof Element ? e.target : null
    const inControl = !!t?.closest('button,input,textarea,select,[contenteditable="true"]')
    const done = (): true => { e.preventDefault(); return true }
    const dir = DIRS[e.key]
    if (dir) {
      if (t?.closest('input,textarea,select,[contenteditable="true"]')) return false
      const j = this.nearest(dir[0], dir[1], project)
      if (j >= 0) this.pick(j)
      return done()
    }
    if (e.key === 'Escape') {
      if (this.foc >= 0) { this.leaveFocus(); return done() }
      if (this.sel >= 0) { this.hd.onSelect(-1); this.setSelected(-1); return done() }
      return false
    }
    if (this.sel < 0) return false
    if (e.key === 'Enter' && !inControl) { this.hd.onOpen(this.sel); return done() }
    const isF = e.key.toLowerCase() === 'f' || e.code === 'KeyF'
    if ((isF || e.key === ' ') && !inControl) {
      if (this.foc === this.sel) this.leaveFocus()
      else { this.hd.onFocus(this.sel); this.setFocus(this.sel, this.neighbours(this.sel)) }
      return done()
    }
    return false
  }

  /** Nearest visible star from the selection (or the view centre) in a screen direction; −1 if none. */
  private nearest(sx: number, sy: number, project: Projector): number {
    const d = this.data!
    const pos = d.positions[this.layout]
    let ox = this.w / 2, oy = this.hgt / 2
    if (this.sel >= 0) { const o = project(pos[3 * this.sel], pos[3 * this.sel + 1], pos[3 * this.sel + 2]); ox = o.x; oy = o.y }
    let best = -1, bs = Infinity
    for (let i = 0; i < d.count; i++) {
      if (i === this.sel) continue
      const p = project(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2])
      if (!p.visible) continue
      const dx = p.x - ox, dy = p.y - oy
      let score: number
      if (this.sel < 0) score = dx * dx + dy * dy
      else {
        const along = dx * sx + dy * sy
        if (along <= 0) continue
        score = along + 2 * Math.abs(dx * sy + dy * sx)
      }
      if (score < bs) { bs = score; best = i }
    }
    return best
  }

  destroy(): void {
    this.ro?.disconnect()
    this.el.remove()
  }
}
