/**
 * Canvas view for `.canvas` files (JSON Canvas): glass cards on a 22px dot grid, curved edges, groups.
 * DOM follows Obsidian: `.canvas-wrapper > .canvas > .canvas-node > .canvas-node-container`, edges in `svg.canvas-edges`.
 * Mouse: drag to move / pan, wheel to pan, Ctrl+wheel to zoom, drag a side dot to connect, double-click to edit.
 * Keyboard: Tab through cards, arrows move (Alt+arrows resize), Enter edits / opens, Delete removes, Shift+F10 menu,
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo. Draw mode: drag draws a stroke (kept in `.aether/canvas-extra`, not in the file).
 */
import {
  bounds, canvasExtraPath, edgePath, facingSide, hasEdge, withoutDuplicateEdges, newId, nodesInGroup, parseCanvas, serializeCanvas, strokePath,
  type CanvasData, type CanvasEdge, type CanvasNode, type FileNode, type GroupNode, type Rect, type Side, type Stroke, type TextNode,
} from '../../core/canvas/canvasData.js'
import { TFile } from '../../core/vault/files.js'
import { Component } from '../component.js'
import { MarkdownRenderer } from '../editor/render.js'
import { Menu, Modal, Notice, Setting } from '../ui.js'
import { addTagToFile, confirm, promptText, removeTag, restoreTexts, TAG_MIME, type TextUndo } from '../views/fileActions.js'
import { undoToast } from '../undoToast.js'
import { getAllTags } from '../../core/metadata/tags.js'
import { FileView, type WorkspaceLeaf } from '../workspace.js'
import { cardFontPx, fontStack, loadAppearance } from '../appearance.js'
import { inkColor } from './ink.js'
import { card, openNoteMenu, vAlignOf, type NoteMenuHost } from './noteMenu.js'

/** Copied cards, shared by every canvas (Ctrl+C / Ctrl+X -> Ctrl+V). */
let boardClip: { nodes: CanvasNode[]; edges: CanvasEdge[]; strokes: Stroke[]; text: string; pasted: number; cut?: boolean } | null = null
const SPRING_HOLD = 400 // ms: holding P longer than this draws only while held

const SVG = 'http://www.w3.org/2000/svg'
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const GRID = 22
const IMAGE_EXT = /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i
/** Screen spacing of the background dots: it follows the zoom, but doubles or halves to stay between ~16 and ~33 px, so zooming out never packs them into a grey mesh. */
export function dotStep(zoom: number) {
  let step = GRID * zoom
  while (step < GRID * 0.75) step *= 2
  while (step > GRID * 1.5) step /= 2
  return step
}
const MIN_W = 80
const MIN_H = 50
const SAVE_DELAY = 400
const HISTORY = 100
const STROKE_WIDTH = 3
const COLORS = [
  ['1', 'Червоний'], ['2', 'Помаранчевий'], ['3', 'Жовтий'], ['4', 'Зелений'], ['5', 'Блакитний'], ['6', 'Фіолетовий'], ['', 'Без кольору'],
] as const
/** Aether's «Список» type: every body line becomes a list item (the first line stays the title). */
const asBullets = (text: string) => text.split('\n').map((l, i) => (i === 0 || !l.trim() || /^\s*([-*+]|\d+\.)\s/.test(l) ? l : `- ${l}`)).join('\n')

const nodeLabel = (n: CanvasNode) =>
  n.type === 'text' ? (n.text.split('\n')[0].replace(/^#+\s*/, '').replace(/[*_`~]|\[\[|\]\]/g, '').trim() || 'Порожня картка')
    : n.type === 'file' ? n.file.replace(/\.md$/, '').split('/').pop()!
      : n.type === 'group' ? `Рамка ${n.label ?? ''}`.trim() : n.url

export class CanvasView extends FileView {
  override icon = 'layout-dashboard'
  data: CanvasData = { nodes: [], edges: [] }
  /** text last read from or written to disk */
  private raw = ''
  /** a file we could not read is never written */
  private broken = false
  private readonly wrapper: HTMLElement
  private readonly world: HTMLElement
  private readonly edgesEl: SVGSVGElement
  private readonly labelsEl: HTMLElement
  private readonly strokesEl: SVGSVGElement
  private readonly nodeEls = new Map<string, HTMLElement>()
  private cards = new Component()
  private t = { x: 0, y: 0, zoom: 1 }
  private selected = new Set<string>()
  private selectedEdge: string | null = null
  /** drawings selected (click; Ctrl+click adds or removes one) */
  private readonly selectedStrokes = new Set<string>()
  private editing: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private writing = false
  strokes: Stroke[] = []
  /** other fields of the extra file, kept as they are */
  private extra: Record<string, unknown> = {}
  /** extra file text as last read or written (normalized) */
  private extraRaw = ''
  private extraBroken = false
  drawing = false
  /** snapshots of `{ data, strokes }` before each change */
  private undoStack: string[] = []
  private redoStack: string[] = []

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.wrapper = this.contentEl.createDiv({
      cls: 'canvas-wrapper',
      attr: { tabindex: '0', role: 'region', 'aria-roledescription': 'полотно', 'aria-label': 'Полотно. Подвійний клік — нова картка.' },
    })
    this.world = this.wrapper.createDiv('canvas')
    this.edgesEl = document.createElementNS(SVG, 'svg')
    this.edgesEl.classList.add('canvas-edges')
    this.edgesEl.innerHTML = '<defs><marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>'
    this.world.appendChild(this.edgesEl)
    this.labelsEl = this.world.createDiv('canvas-edge-labels')
    this.strokesEl = document.createElementNS(SVG, 'svg')
    this.strokesEl.classList.add('canvas-strokes')
    this.world.appendChild(this.strokesEl)
    this.listen()
  }

  getViewType() { return 'canvas' }
  get zoom() { return this.t.zoom }

  async onOpen() {
    const vault = this.app.vault
    this.registerEvent(vault.on('modify', (f) => {
      if (f === this.file && !this.writing) void this.reloadIfChanged()
      else if (f instanceof TFile && this.data.nodes.some((n) => n.type === 'file' && n.file === f.path)) this.renderAll()
    }))
    // a note's tags changed: its cards redraw their corner tags
    this.registerEvent(this.app.metadataCache.on('changed', (f) => {
      if (this.data.nodes.some((n) => n.type === 'file' && n.file === f.path)) this.renderAll()
    }))
    this.registerEvent(vault.on('rename', (f, oldPath) => {
      // cards follow their notes, like links do
      let changed = false
      for (const n of this.data.nodes) if (n.type === 'file' && n.file === oldPath) { n.file = f.path; changed = true }
      // older snapshots would point the cards back at the old path
      if (changed) { this.undoStack = []; this.redoStack = []; this.renderAll(); this.requestSave() }
      if (f === this.file) { this.leaf.updateHeader(); void this.moveExtra(oldPath) }
    }))
    this.registerEvent(vault.on('delete', (f) => {
      if (f === this.file) { this.file = null; void this.leaf.detach() }
      else if (this.data.nodes.some((n) => n.type === 'file' && n.file === f.path)) this.renderAll()
    }))
  }

  async onLoadFile(file: TFile) {
    await this.loadExtra(file)
    await this.loadText(await this.app.vault.read(file))
    this.fitView()
  }
  async onUnloadFile() { await this.save() }
  async onClose() {
    await this.save()
    this.cards.unload()
  }

  private async loadText(text: string) {
    this.raw = text
    try {
      this.data = parseCanvas(text)
      this.broken = false
    } catch (e) {
      console.error(e)
      this.data = { nodes: [], edges: [] }
      this.broken = true
    }
    this.selected.clear()
    this.undoStack = []
    this.redoStack = []
    if (this.broken) this.setDrawMode(false)
    this.renderAll()
  }

  /** Strokes and anything else we keep for this canvas outside the file. A broken extra file is never written. */
  private async loadExtra(file: TFile) {
    const adapter = this.app.vault.adapter
    const path = canvasExtraPath(this.app.vault.configDir, file.path)
    this.extra = {}
    this.extraBroken = false
    try {
      if (await adapter.exists(path)) {
        const data = JSON.parse(await adapter.read(path))
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Canvas extra file is not a JSON object')
        this.extra = data
      }
    } catch (e) {
      console.error(e)
      this.extraBroken = true
      new Notice(`Малюнки полотна «${file.basename}» не вдалося прочитати. Aether не змінюватиме їх, щоб не зіпсувати.`)
    }
    this.strokes = Array.isArray(this.extra.strokes) ? (this.extra.strokes as Stroke[]).filter((s) => Array.isArray(s?.points)) : []
    this.extraRaw = this.extraText()
  }
  private extraText() { return JSON.stringify({ ...this.extra, strokes: this.strokes }, null, '\t') }

  /** The extra file follows its canvas when it is renamed or moved. */
  private async moveExtra(oldPath: string) {
    const adapter = this.app.vault.adapter
    const from = canvasExtraPath(this.app.vault.configDir, oldPath)
    if (!this.file || !(await adapter.exists(from))) return
    await adapter.rename(from, canvasExtraPath(this.app.vault.configDir, this.file.path)).catch((e) => console.error(e))
  }

  private async reloadIfChanged() {
    if (!this.file || this.isDirty()) return
    const text = await this.app.vault.read(this.file)
    if (text !== this.raw) await this.loadText(text)
  }

  // ---- saving ---------------------------------------------------------------

  isDirty() {
    return !!this.file && ((!this.broken && serializeCanvas(this.data) !== this.raw) || (!this.extraBroken && this.extraText() !== this.extraRaw))
  }
  requestSave() {
    if (this.broken) return
    clearTimeout(this.saveTimer)
    this.app.setSaveState('pending')
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY)
  }
  /** Writes only what changed: strokes alone never touch the .canvas file. */
  async save() {
    clearTimeout(this.saveTimer)
    const file = this.file
    if (!file || this.broken) return
    const text = serializeCanvas(this.data)
    const extra = this.extraText()
    const extraChanged = !this.extraBroken && extra !== this.extraRaw
    // an undo can bring back what is already on disk
    if (text === this.raw && !extraChanged) { this.app.setSaveState(this.app.hasUnsaved() ? 'pending' : 'saved'); return }
    try {
      this.writing = true
      if (text !== this.raw) {
        await this.app.vault.modify(file, text)
        this.raw = text
      }
      if (extraChanged) {
        const path = canvasExtraPath(this.app.vault.configDir, file.path)
        await this.app.vault.adapter.mkdir(path.slice(0, path.lastIndexOf('/')))
        await this.app.vault.adapter.write(path, extra)
        this.extraRaw = extra
      }
      this.app.setSaveState(this.app.hasUnsaved() ? 'pending' : 'saved')
    } catch (e) {
      console.error(e)
      this.app.setSaveState('error')
      new Notice(`Не вдалося зберегти полотно «${file.basename}».`)
    } finally {
      this.writing = false
    }
  }
  private changed() {
    this.renderEdges()
    this.requestSave()
  }

  // ---- undo -------------------------------------------------------------------

  private snapshot() { return JSON.stringify({ data: this.data, strokes: this.strokes }) }
  /** Call before a change. A drag passes the snapshot it took when it started, so it is one step. */
  private checkpoint(before = this.snapshot()) {
    this.undoStack.push(before)
    if (this.undoStack.length > HISTORY) this.undoStack.shift()
    this.redoStack = []
  }
  undo() { this.step(this.undoStack, this.redoStack) }
  redo() { this.step(this.redoStack, this.undoStack) }
  private step(from: string[], to: string[]) {
    const s = from.pop()
    if (!s) return
    to.push(this.snapshot())
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.canvas-node')?.dataset.id
    ;({ data: this.data, strokes: this.strokes } = JSON.parse(s))
    this.selected.clear()
    this.selectedEdge = null
    this.selectedStrokes.clear()
    this.renderAll()
    ;((focused && this.nodeEls.get(focused)) || this.wrapper).focus()
    this.requestSave()
  }

  // ---- view transform ---------------------------------------------------------

  private applyTransform() {
    const { x, y, zoom } = this.t
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    const step = dotStep(zoom)
    this.wrapper.style.backgroundSize = `${step}px ${step}px`
    this.wrapper.style.backgroundPosition = `${x}px ${y}px`
    this.app.workspace.trigger('canvas:zoom', this)
  }
  private toWorld(clientX: number, clientY: number) {
    const r = this.wrapper.getBoundingClientRect()
    return { x: (clientX - r.left - this.t.x) / this.t.zoom, y: (clientY - r.top - this.t.y) / this.t.zoom }
  }
  private center() {
    const r = this.wrapper.getBoundingClientRect()
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2)
  }

  /** Wheel target the view eases toward; any other move of the view (drag, buttons, fit) stops it. */
  private glide: { to: { x: number; y: number; zoom: number }; set: { x: number; y: number; zoom: number }; last: number; frame: number } | null = null

  /** Each wheel notch sets a target and the view eases to it (~120 ms), so a mouse wheel pans and zooms without jumps. */
  private glideTo(to: { x: number; y: number; zoom: number }) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { this.t = to; this.applyTransform(); return }
    if (this.glide) { this.glide.to = to; return }
    const step = (now: number) => {
      const g = this.glide
      if (!g || this.t !== g.set) { this.glide = null; return } // someone else moved the view
      const a = 1 - Math.exp(-(now - g.last) / 40) // time-based: same feel at 60 and 144 Hz
      g.last = now
      const zoom = Math.exp(Math.log(this.t.zoom) + (Math.log(g.to.zoom) - Math.log(this.t.zoom)) * a)
      const near = Math.abs(g.to.x - this.t.x) < 0.3 && Math.abs(g.to.y - this.t.y) < 0.3 && Math.abs(g.to.zoom - zoom) < 0.0005
      this.t = near ? { ...g.to } : { x: this.t.x + (g.to.x - this.t.x) * a, y: this.t.y + (g.to.y - this.t.y) * a, zoom }
      g.set = this.t
      this.applyTransform()
      if (near) this.glide = null
      else g.frame = requestAnimationFrame(step)
    }
    this.glide = { to, set: this.t, last: performance.now(), frame: requestAnimationFrame(step) }
  }

  /** Zooms by `factor` around a screen point (default: the middle). */
  zoomBy(factor: number, clientX?: number, clientY?: number) {
    const r = this.wrapper.getBoundingClientRect()
    const px = (clientX ?? r.left + r.width / 2) - r.left
    const py = (clientY ?? r.top + r.height / 2) - r.top
    const zoom = Math.min(4, Math.max(0.1, this.t.zoom * factor))
    this.t = { x: px - ((px - this.t.x) / this.t.zoom) * zoom, y: py - ((py - this.t.y) / this.t.zoom) * zoom, zoom }
    this.applyTransform()
  }
  zoomReset() { this.zoomBy(1 / this.t.zoom) }

  /** Shows all cards, never zoomed in past 100%. */
  fitView() {
    const r = this.wrapper.getBoundingClientRect()
    const b = bounds(this.data.nodes)
    if (!b || !r.width) {
      this.t = { x: r.width / 2, y: r.height / 2, zoom: 1 }
    } else {
      const zoom = Math.min(1, (r.width - 120) / b.width, (r.height - 160) / b.height)
      this.t = { zoom, x: r.width / 2 - (b.x + b.width / 2) * zoom, y: r.height / 2 - (b.y + b.height / 2) * zoom }
    }
    this.applyTransform()
  }

  /** Centres one card at 100% (or the current zoom, if closer) and selects it — how the Galaxy opens a card. */
  revealNode(id: string) {
    const n = this.data.nodes.find((x) => x.id === id)
    if (!n) return false
    const r = this.wrapper.getBoundingClientRect()
    const zoom = Math.max(1, this.t.zoom)
    this.t = { zoom, x: r.width / 2 - (n.x + n.width / 2) * zoom, y: r.height / 2 - (n.y + n.height / 2) * zoom }
    this.applyTransform()
    this.select([id])
    return true
  }

  // ---- rendering --------------------------------------------------------------

  private renderAll() {
    this.cards.unload()
    this.cards = new Component()
    this.cards.load()
    for (const el of this.nodeEls.values()) el.remove()
    this.nodeEls.clear()
    this.world.querySelector('.canvas-empty, .canvas-broken')?.remove()
    if (this.broken) {
      this.world.createDiv({ cls: 'canvas-broken', text: 'Цей файл полотна не вдалося прочитати. Aether не змінюватиме його, щоб не зіпсувати.' })
    } else if (!this.data.nodes.length) {
      this.world.createDiv({ cls: 'canvas-empty', text: 'Двічі клікніть, щоб додати картку, або перетягніть нотатку з бічної панелі.' })
    }
    // groups under everything else
    const ordered = [...this.data.nodes.filter((n) => n.type === 'group'), ...this.data.nodes.filter((n) => n.type !== 'group')]
    for (const n of ordered) this.renderNode(n)
    this.renderEdges()
    this.renderStrokes()
    this.applyTransform()
  }

  /** Cards that share the layer order with drawings (frames always stay underneath both). */
  private layered() { return this.data.nodes.filter((n) => n.type !== 'group') }
  /** A drawing's layer: how many cards lie under it (`z` in the file; none = above every card, as before). */
  private zOf(s: Stroke, count = this.layered().length) { return typeof s.z === 'number' ? Math.max(0, Math.min(count, s.z)) : count }

  private renderStrokes() {
    this.strokesEl.replaceChildren()
    for (const el of [...this.world.querySelectorAll(':scope > .canvas-strokes.is-layer')]) el.remove()
    const cards = this.layered()
    const layers = new Map<number, SVGSVGElement>()
    for (const s of this.strokes) {
      const z = this.zOf(s, cards.length)
      let layer = z >= cards.length ? this.strokesEl : layers.get(z)
      if (!layer) {
        // one SVG per layer, put right before the first card above it
        layer = document.createElementNS(SVG, 'svg')
        layer.classList.add('canvas-strokes', 'is-layer')
        this.world.insertBefore(layer, this.nodeEls.get(cards[z].id) ?? this.edgesEl)
        layers.set(z, layer)
      }
      const g = document.createElementNS(SVG, 'g')
      g.classList.add('canvas-stroke')
      g.classList.toggle('is-selected', this.selectedStrokes.has(s.id))
      g.dataset.id = s.id
      if (s.color) g.style.color = s.color
      const d = strokePath(s.points)
      for (const cls of ['canvas-stroke-hit', 'canvas-stroke-path']) {
        const path = document.createElementNS(SVG, 'path')
        path.setAttribute('d', d)
        path.classList.add(cls)
        g.appendChild(path)
      }
      g.lastElementChild!.setAttribute('stroke-width', String(s.width || STROKE_WIDTH))
      layer.appendChild(g)
    }
  }

  /**
   * Changes the cards' order and keeps every drawing where it was among the cards that did not move:
   * a drawing stays just above the nearest unmoved card under it. So a card sent to the front rises above
   * the drawings, one sent back goes under them, and deleting a card leaves the drawings in place.
   */
  private relayer(moved: Set<string>, change: () => void, sentBack = false) {
    const before = this.layered()
    const anchors = this.strokes.map((s) => {
      for (let i = this.zOf(s, before.length) - 1; i >= 0; i--) if (!moved.has(before[i].id)) return before[i].id
      return null
    })
    change()
    const after = this.layered()
    // no unmoved card under a drawing: it goes to the bottom, above only the cards just sent back
    const bottom = sentBack ? after.filter((n) => moved.has(n.id)).length : 0
    this.strokes.forEach((s, k) => {
      const a = anchors[k]
      s.z = a ? after.findIndex((n) => n.id === a) + 1 : bottom
    })
  }

  private renderNode(n: CanvasNode) {
    const el = createDiv({
      cls: `canvas-node canvas-node-${n.type}`,
      attr: { tabindex: '0', 'data-id': n.id, role: 'group', 'aria-roledescription': n.type === 'group' ? 'рамка' : 'картка', 'aria-label': nodeLabel(n) },
    })
    this.world.insertBefore(el, this.edgesEl)
    this.nodeEls.set(n.id, el)
    if (n.color) el.style.setProperty('--canvas-color', /^\d$/.test(n.color) ? `var(--canvas-color-${n.color})` : n.color)
    el.toggleClass('is-selected', this.selected.has(n.id))
    this.place(n)

    if (n.type === 'group') {
      el.createDiv({ cls: 'canvas-group-label', text: n.label ?? '' })
    } else {
      // Aether's card look: type, title alignment, font, text size, photo, pinned position
      const c = card(n)
      el.addClass(`note-style-${c['aether-style'] ?? 'plain'}`, `title-align-${c['aether-titleAlign'] ?? 'center'}`, `v-align-${vAlignOf(c)}`)
      el.toggleClass('is-locked', !!c['aether-locked'])
      if (c['aether-font'] && c['aether-font'] !== 'auto') el.style.setProperty('--nf', fontStack(c['aether-font']))
      el.style.setProperty('--card-px', `${cardFontPx(loadAppearance(), c['aether-fontSize'], n.width, n.height)}px`)
      const image = c['aether-image'] && this.app.vault.getFileByPath(c['aether-image'].file)
      if (image) {
        const bg = el.createDiv({ cls: 'canvas-node-image', attr: { 'aria-hidden': 'true' } })
        bg.style.backgroundImage = `url("${this.app.vault.getResourcePath(image)}")`
        bg.style.backgroundSize = c['aether-image']!.fit ?? 'cover'
        bg.style.setProperty('--dim', String(c['aether-image']!.dim ?? 0))
        el.addClass('has-image')
      }
      const box = el.createDiv('canvas-node-container')
      const content = box.createDiv('canvas-node-content markdown-rendered')
      if (n.type === 'text') void MarkdownRenderer.render(this.app, c['aether-style'] === 'bullets' ? asBullets(n.text) : n.text, content, this.file?.path ?? '', this.cards)
      else if (n.type === 'file') this.renderFileCard(n, box, content)
      else content.createEl('a', { text: n.url, href: n.url })
      const tags = this.cardTags(n, true)
      if (tags.length) el.createDiv({ cls: 'canvas-node-tags', text: tags.join(' ') })
      // fade the bottom edge only while there is more text below
      const fade = () => content.classList.toggle('is-clipped', content.scrollTop + content.clientHeight < content.scrollHeight - 2)
      content.addEventListener('scroll', fade, { passive: true })
      requestAnimationFrame(fade); setTimeout(fade, 300)
    }
    for (const side of SIDES) el.createDiv({ cls: `canvas-node-connection-point mod-${side}`, attr: { 'data-side': side, 'aria-hidden': 'true' } })
    el.createDiv({ cls: 'canvas-node-resizer', attr: { 'aria-hidden': 'true' } })
  }

  /** Tags shown faintly in the card's bottom-right corner. */
  /** Every tag of a card: the card menu offers to remove any of them. `cornerOnly`: just the ones the corner label shows. */
  private cardTags(n: CanvasNode, cornerOnly = false): string[] {
    if (n.type === 'file') {
      const file = this.app.vault.getFileByPath(n.file)
      const cache = file && this.app.metadataCache.getFileCache(file)
      if (!cache) return []
      const all = [...new Set(getAllTags(cache))]
      if (!cornerOnly) return all
      // the corner skips tags written in the visible text, so nothing shows twice
      const inline = new Set((cache.tags ?? []).map((t) => t.tag.toLowerCase()))
      return all.filter((t) => !inline.has(t.toLowerCase()))
    }
    return card(n)['aether-tags'] ?? []
  }

  async addTag(n: CanvasNode, tag: string) {
    if (n.type === 'file') {
      const file = this.app.vault.getFileByPath(n.file)
      if (file) await addTagToFile(this.app, file, tag)
      return
    }
    const list = card(n)['aether-tags'] ?? []
    if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    this.checkpoint()
    card(n)['aether-tags'] = [...list, tag]
    this.renderAll()
    this.requestSave()
  }

  /** A note card loses the tag in its file (text and frontmatter); a text card on the node. */
  async removeCardTag(n: CanvasNode, tag: string) {
    if (n.type === 'file') {
      const file = this.app.vault.getFileByPath(n.file)
      if (!file) return
      // the note's file changes, which Ctrl+Z on the canvas cannot take back: offer the undo toast
      const texts: TextUndo = new Map()
      await removeTag(this.app, tag, [file], texts)
      undoToast(`Тег ${tag} прибрано з «${file.basename}»`, () => restoreTexts(this.app, texts))
      return
    }
    const rest = (card(n)['aether-tags'] ?? []).filter((t) => t.toLowerCase() !== tag.toLowerCase())
    this.checkpoint()
    if (rest.length) card(n)['aether-tags'] = rest
    else delete card(n)['aether-tags']
    this.renderAll()
    this.requestSave()
  }

  private renderFileCard(n: FileNode, box: HTMLElement, content: HTMLElement) {
    const file = this.app.vault.getFileByPath(n.file)
    // the note's name sits above the card (as in Obsidian), so it never collides with the card's own heading or editor
    const label = box.parentElement!.createDiv({ cls: 'canvas-node-label', text: file?.basename ?? n.file })
    if (!file) {
      content.createDiv({ cls: 'canvas-node-missing', text: `Нотатку «${n.file}» не знайдено.` })
      return
    }
    if (IMAGE_EXT.test(file.extension)) {
      box.parentElement!.addClass('is-image-file')
      content.createEl('img', { cls: 'canvas-node-img', attr: { src: this.app.vault.getResourcePath(file), alt: file.basename, draggable: 'false' } })
      return
    }
    void this.app.vault.cachedRead(file).then((text) => {
      // the card's own first heading already says the name: do not repeat it above (the card keeps its aria-label)
      const first = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n').find((l) => l.trim())
      const h = first?.match(/^#{1,6}\s+(.*?)\s*#*\s*$/)
      if (h && h[1].trim().toLowerCase() === file.basename.trim().toLowerCase()) label.addClass('is-redundant')
      return MarkdownRenderer.render(this.app, text, content, file.path, this.cards)
    })
  }

  private place(n: CanvasNode) {
    const el = this.nodeEls.get(n.id)
    if (!el) return
    Object.assign(el.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.width}px`, height: `${n.height}px` })
  }

  private node(id: string) { return this.data.nodes.find((n) => n.id === id) }

  private renderEdges() {
    for (const g of [...this.edgesEl.querySelectorAll('g')]) g.remove()
    this.labelsEl.empty()
    for (const e of this.data.edges) {
      const from = this.node(e.fromNode)
      const to = this.node(e.toNode)
      if (!from || !to) continue
      const { d, mid } = edgePath(from, to, e.fromSide, e.toSide)
      const g = document.createElementNS(SVG, 'g')
      g.classList.add('canvas-edge')
      g.classList.toggle('is-selected', this.selectedEdge === e.id)
      g.dataset.id = e.id
      if (e.color) g.style.setProperty('--canvas-color', /^\d$/.test(e.color) ? `var(--canvas-color-${e.color})` : e.color)
      const hit = document.createElementNS(SVG, 'path')
      hit.setAttribute('d', d)
      hit.classList.add('canvas-edge-hit')
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', d)
      path.classList.add('canvas-edge-path')
      if (e.toEnd !== 'none') path.setAttribute('marker-end', 'url(#canvas-arrow)')
      if (e.fromEnd === 'arrow') path.setAttribute('marker-start', 'url(#canvas-arrow)')
      g.append(hit, path)
      this.edgesEl.appendChild(g)
      if (e.label) {
        const label = this.labelsEl.createDiv({ cls: 'canvas-edge-label', text: e.label, attr: { 'data-id': e.id } })
        Object.assign(label.style, { left: `${mid.x}px`, top: `${mid.y}px` })
      }
    }
  }

  /** @internal ids of the selected cards */
  selectedIds() { return [...this.selected] }

  select(ids: string[], add = false) {
    if (!add) this.selected.clear()
    for (const id of ids) this.selected.add(id)
    this.selectedEdge = null
    if (!add) this.selectedStrokes.clear()
    for (const [id, el] of this.nodeEls) el.toggleClass('is-selected', this.selected.has(id))
    this.renderEdges()
    this.renderStrokes()
  }

  // ---- editing ----------------------------------------------------------------

  /** Puts a new card where it covers no other card: if it would, it goes to the right of them. */
  private freeSpot(n: CanvasNode) {
    const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const cards = this.data.nodes.filter((x) => x.type !== 'group')
    if (n.type === 'group' || !cards.some((x) => overlaps(x, n))) return
    const b = bounds(cards)!
    n.x = b.x + b.width + 60
  }

  private addNode<T extends CanvasNode>(n: T): T {
    this.checkpoint()
    this.freeSpot(n)
    this.data.nodes.push(n)
    this.renderAll()
    this.select([n.id])
    this.nodeEls.get(n.id)?.focus()
    this.requestSave()
    return n
  }

  addTextCard(at = this.center()) {
    const n = this.addNode<TextNode>({ id: newId(), type: 'text', text: '', x: at.x - 130, y: at.y - 70, width: 260, height: 140 })
    this.editText(n)
  }

  addFileCard(file: TFile, at = this.center()) {
    this.addNode<FileNode>({ id: newId(), type: 'file', file: file.path, x: at.x - 200, y: at.y - 150, width: 400, height: 300 })
  }

  /** A frame around the selected cards, or an empty one in the middle. */
  addGroup() {
    const around = bounds(this.data.nodes.filter((n) => this.selected.has(n.id)))
    const c = this.center()
    const r: Rect = around
      ? { x: around.x - 30, y: around.y - 30, width: around.width + 60, height: around.height + 60 }
      : { x: c.x - 200, y: c.y - 150, width: 400, height: 300 }
    this.addNode<GroupNode>({ id: newId(), type: 'group', label: 'Рамка', ...r })
  }

  removeNodes(ids: string[]) {
    if (!ids.length) return
    this.checkpoint()
    this.relayer(new Set(ids), () => { this.data.nodes = this.data.nodes.filter((n) => !ids.includes(n.id)) })
    this.data.edges = this.data.edges.filter((e) => !ids.includes(e.fromNode) && !ids.includes(e.toNode))
    this.selected.clear()
    this.renderAll()
    this.focusQuietly()
    this.requestSave()
  }

  /** false when the same path is already there (it would only lie on top of the old one). */
  connect(from: CanvasNode, to: CanvasNode, fromSide?: Side, toSide?: Side) {
    if (from === to) return false
    const fs = fromSide ?? facingSide(from, to)
    const ts = toSide ?? facingSide(to, from)
    if (hasEdge(this.data.edges, from.id, fs, to.id, ts)) {
      new Notice('Такий зв’язок уже є.')
      return false
    }
    this.checkpoint()
    this.data.edges.push({ id: newId(), fromNode: from.id, fromSide: fs, toNode: to.id, toSide: ts })
    this.changed()
    return true
  }

  /** Removes edges drawn twice on the same path; Ctrl+Z brings them back. Returns how many went. */
  removeDuplicateEdges() {
    const rest = withoutDuplicateEdges(this.data.edges)
    const removed = this.data.edges.length - rest.length
    if (removed) {
      this.checkpoint()
      this.data.edges = rest
      this.changed()
    }
    new Notice(removed ? `Прибрано повторних зв’язків: ${removed}. Повернути — Ctrl+Z.` : 'Повторних зв’язків немає.')
    return removed
  }

  /** `color` is a preset '1'…'6'; '' removes it. */
  setColor(nodes: CanvasNode[], color: string) {
    this.checkpoint()
    for (const n of nodes) {
      if (color) n.color = color
      else delete n.color
      // in place, so the focused card keeps focus
      const el = this.nodeEls.get(n.id)
      if (color) el?.style.setProperty('--canvas-color', `var(--canvas-color-${color})`)
      else el?.style.removeProperty('--canvas-color')
    }
    this.requestSave()
  }

  setDrawMode(on: boolean) {
    // nothing drawn here could be saved
    this.drawing = on && !this.broken && !this.extraBroken
    this.wrapper.toggleClass('is-drawing', this.drawing)
    this.app.workspace.trigger('canvas:draw', this)
  }

  /** Drags the selected drawings: they only shift on screen while moving; the points change once, at the end (one undo step). */
  private dragStrokes(before = this.snapshot()) {
    const els = [...this.world.querySelectorAll<SVGGElement>('.canvas-stroke.is-selected')]
    let d = { x: 0, y: 0 }
    return {
      move: (x: number, y: number) => { d = { x, y }; for (const g of els) g.setAttribute('transform', `translate(${x} ${y})`) },
      commit: () => {
        for (const g of els) g.removeAttribute('transform')
        if (!d.x && !d.y) return
        for (const s of this.strokes) if (this.selectedStrokes.has(s.id)) s.points = s.points.map(([px, py]) => [Math.round((px + d.x) * 10) / 10, Math.round((py + d.y) * 10) / 10])
        this.checkpoint(before)
        this.renderStrokes()
        this.requestSave()
      },
    }
  }

  addStroke(points: [number, number][]) {
    this.checkpoint()
    this.strokes.push({ id: newId(), points, width: STROKE_WIDTH, color: inkColor(), z: this.layered().length })
    this.renderStrokes()
    this.requestSave()
  }

  private removeStrokes(ids: string[]) {
    this.checkpoint()
    this.strokes = this.strokes.filter((s) => !ids.includes(s.id))
    this.selectedStrokes.clear()
    this.renderStrokes()
    this.requestSave()
  }

  async clearStrokes() {
    if (!this.strokes.length) return
    if (!(await confirm(this.app, 'Очистити малюнки?', 'Видалити всі малюнки з цього полотна? Це можна скасувати: Ctrl+Z.', 'Очистити'))) return
    this.checkpoint()
    this.strokes = []
    this.selectedStrokes.clear()
    this.renderStrokes()
    this.requestSave()
  }

  private editText(n: TextNode) {
    const el = this.nodeEls.get(n.id)
    const box = el?.querySelector<HTMLElement>('.canvas-node-container')
    if (!el || !box) return
    this.editing = n.id
    this.nodeEls.get(n.id)?.addClass('is-editing')
    box.empty()
    const area = box.createEl('textarea', { cls: 'canvas-node-editor', attr: { 'aria-label': 'Текст картки (Markdown). Escape — готово.' } })
    area.value = n.text
    const finish = () => {
      if (this.editing !== n.id) return
      this.editing = null
      if (area.value !== n.text) { this.checkpoint(); n.text = area.value; this.requestSave() }
      this.renderAll()
      this.nodeEls.get(n.id)?.focus()
    }
    area.addEventListener('blur', finish)
    area.addEventListener('keydown', (e) => {
      e.stopPropagation() // typing must not move or delete the card
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); area.blur() }
    })
    area.focus()
  }

  /** A note card edits the note's own text in place; it is saved to the note file, not the canvas. */
  private async editFileCard(n: FileNode) {
    const file = this.app.vault.getFileByPath(n.file)
    const box = this.nodeEls.get(n.id)?.querySelector<HTMLElement>('.canvas-node-container')
    if (!file || !box || file.extension !== 'md') return // only notes are text: never open an image as text
    const before = await this.app.vault.read(file)
    this.editing = n.id
    this.nodeEls.get(n.id)?.addClass('is-editing')
    box.querySelector('.canvas-node-content')?.remove()
    const area = box.createEl('textarea', { cls: 'canvas-node-editor', attr: { 'aria-label': `Текст нотатки «${file.basename}» (Markdown). Escape — готово.` } })
    area.value = before
    const finish = async () => {
      if (this.editing !== n.id) return
      this.editing = null
      try {
        if (area.value !== before) await this.app.vault.modify(file, area.value)
      } catch (e) {
        console.error(e)
        new Notice(`Не вдалося зберегти «${file.basename}».`)
      }
      this.renderAll()
      this.nodeEls.get(n.id)?.focus()
    }
    area.addEventListener('blur', () => void finish())
    area.addEventListener('keydown', (e) => {
      e.stopPropagation() // typing must not move or delete the card
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); area.blur() }
    })
    area.focus()
  }

  private async openNote(n: FileNode) {
    const file = this.app.vault.getFileByPath(n.file)
    if (file) await this.app.workspace.getLeaf(true).openFile(file)
  }

  private async openOrEdit(n: CanvasNode) {
    if (n.type === 'text') this.editText(n)
    else if (n.type === 'file') await this.editFileCard(n)
    else if (n.type === 'group') {
      const label = await promptText(this.app, 'Назва рамки', n.label ?? '', 'Зберегти', () => null)
      if (label !== null) { this.checkpoint(); n.label = label; this.renderAll(); this.requestSave() }
    }
  }

  private async editEdgeLabel(e: CanvasEdge) {
    const label = await promptText(this.app, 'Підпис зв\'язку', e.label ?? '', 'Зберегти', () => null)
    if (label === null) return
    this.checkpoint()
    if (label) e.label = label
    else delete e.label
    this.changed()
  }

  // ---- menus ------------------------------------------------------------------

  private nodeMenu(n: CanvasNode) {
    const menu = new Menu()
    if (n.type === 'text') menu.addItem((i) => i.setTitle('Редагувати').setIcon('pencil').onClick(() => this.editText(n)))
    if (n.type === 'file') {
      menu.addItem((i) => i.setTitle('Редагувати').setIcon('pencil').onClick(() => void this.editFileCard(n)))
      menu.addItem((i) => i.setTitle('Відкрити нотатку').setIcon('file-text').onClick(() => void this.openNote(n)))
    }
    if (n.type === 'group') menu.addItem((i) => i.setTitle('Перейменувати рамку…').setIcon('pencil').onClick(() => void this.openOrEdit(n)))
    menu.addItem((i) => i.setTitle('З\'єднати з…').setIcon('git-fork').onClick(() => new ConnectModal(this, n).open()))
    const edges = this.data.edges.filter((e) => e.fromNode === n.id || e.toNode === n.id)
    for (const e of edges) {
      const other = this.node(e.fromNode === n.id ? e.toNode : e.fromNode)!
      menu.addItem((i) => i.setTitle(`Підпис зв'язку з «${nodeLabel(other)}»…`).setIcon('tag').onClick(() => void this.editEdgeLabel(e)))
      menu.addItem((i) => i.setTitle(`Видалити зв'язок з «${nodeLabel(other)}»`).setIcon('x').onClick(() => {
        this.checkpoint()
        this.data.edges = this.data.edges.filter((x) => x !== e)
        this.changed()
      }))
    }
    menu.addSeparator()
    const targets = this.data.nodes.filter((x) => x === n || this.selected.has(x.id))
    for (const [color, name] of COLORS) {
      menu.addItem((i) => {
        i.setTitle(name).setIcon(color ? 'circle' : 'circle-off').setChecked((n.color ?? '') === color).onClick(() => this.setColor(targets, color))
        i.dom.setAttr('role', 'menuitemradio')
        if (color) i.iconEl.style.color = `var(--canvas-color-${color})`
      })
    }
    menu.addSeparator()
    menu.addItem((i) => i.setTitle('Видалити').setIcon('trash-2').setWarning(true).onClick(() => this.removeNodes([...new Set([...this.selected, n.id])])))
    return menu
  }

  private backgroundMenu(at: { x: number; y: number }) {
    const menu = new Menu()
      .addItem((i) => i.setTitle('Текстова картка').setIcon('file-plus').onClick(() => this.addTextCard(at)))
      .addItem((i) => i.setTitle('Додати нотатку…').setIcon('file-text').onClick(() => new AddNoteModal(this, at).open()))
      .addItem((i) => i.setTitle('Рамка').setIcon('frame').onClick(() => this.addGroup()))
    if (this.strokes.length) menu.addSeparator().addItem((i) => i.setTitle('Очистити малюнки').setIcon('eraser').setWarning(true).onClick(() => void this.clearStrokes()))
    return menu
  }

  // ---- input ------------------------------------------------------------------

  private listen() {
    const w = this.wrapper
    w.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    // selection may have changed: the app records it for Claude's «what is open now» (debounced, only when it differs)
    const selectionMaybeChanged = () => this.app.workspace.trigger('canvas:selection', this)
    w.addEventListener('pointerup', selectionMaybeChanged)
    w.addEventListener('keyup', selectionMaybeChanged)
    w.addEventListener('wheel', (e) => {
      e.preventDefault()
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w.clientHeight : 1 // lines / pages → px
      const dx = e.deltaX * k, dy = e.deltaY * k
      const to = { ...(this.glide?.to ?? this.t) }
      if (e.ctrlKey || e.metaKey) {
        const r = w.getBoundingClientRect()
        const px = e.clientX - r.left, py = e.clientY - r.top
        const zoom = Math.min(4, Math.max(0.1, to.zoom * Math.exp(-dy / 300)))
        Object.assign(to, { x: px - ((px - to.x) / to.zoom) * zoom, y: py - ((py - to.y) / to.zoom) * zoom, zoom })
      } else { to.x -= dx; to.y -= dy }
      this.glideTo(to)
    }, { passive: false })
    w.addEventListener('dblclick', (e) => {
      if (this.drawing) return
      // pointer capture from the first click sends dblclick to the wrapper: look at what is really under the cursor
      const under = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element)
      const nodeEl = under.closest<HTMLElement>('.canvas-node')
      const edgeEl = under.closest('.canvas-edge, .canvas-edge-label') as HTMLElement | SVGElement | null
      if (nodeEl) void this.openOrEdit(this.node(nodeEl.dataset.id!)!)
      else if (edgeEl) void this.editEdgeLabel(this.data.edges.find((x) => x.id === edgeEl.dataset.id)!)
      else this.addTextCard(this.toWorld(e.clientX, e.clientY))
    })
    w.addEventListener('contextmenu', (e) => {
      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.canvas-node')
      const n = nodeEl && this.node(nodeEl.dataset.id!)
      const strokeId = (e.target as Element).closest<SVGGElement>('.canvas-stroke')?.dataset.id
      if (!n && strokeId) { // one drawing: select it and offer to delete just that one (works while drawing, too)
        e.preventDefault()
        if (!this.selectedStrokes.has(strokeId)) { this.select([]); this.selectedStrokes.add(strokeId) }
        this.renderStrokes()
        const ids = [...this.selectedStrokes]
        const layer = (z: (count: number) => number) => () => {
          this.checkpoint()
          for (const s of this.strokes) if (ids.includes(s.id)) s.z = z(this.layered().length)
          this.renderStrokes()
          this.requestSave()
        }
        const menu = new Menu()
          .addItem((i) => i.setTitle('На передній план').setIcon('bring-to-front').onClick(layer((n) => n)))
          .addItem((i) => i.setTitle('На задній план').setIcon('send-to-back').onClick(layer(() => 0)))
          .addItem((i) => i.setTitle('Вирізати').setIcon('scissors').onClick(() => this.copySelection(true)))
          .addSeparator()
          .addItem((i) => i.setTitle(ids.length > 1 ? `Видалити малюнки (${ids.length})` : 'Видалити малюнок').setIcon('trash-2').setWarning(true).onClick(() => this.removeStrokes(ids)))
        menu.showAtMouseEvent(e)
      } else if (n && n.type !== 'group') { e.preventDefault(); this.openCardMenu(n, { x: e.clientX, y: e.clientY }) }
      else if (n) this.nodeMenu(n).showAtMouseEvent(e)
      else this.backgroundMenu(this.toWorld(e.clientX, e.clientY)).showAtMouseEvent(e)
    })
    w.addEventListener('focusin', (e) => {
      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>('.canvas-node')
      if (nodeEl && !this.selected.has(nodeEl.dataset.id!) && !this.editing) this.select([nodeEl.dataset.id!])
    })
    w.addEventListener('keydown', (e) => this.onKey(e))
    w.addEventListener('paste', (e) => this.onPaste(e))
    this.registerDomEvent(window, 'aether:appearance', () => this.renderAll()) // global font / size changed in Settings
    // links inside cards: open in the app, never navigate the window
    w.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      e.preventDefault()
      if (a.hasClass('internal-link')) void this.app.workspace.openLinkText(a.dataset.href ?? '', this.file?.path ?? '', true)
    })
    // a note dragged in from the file tree becomes a card
    w.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-aether-path')) e.preventDefault() })
    // a tag pill dropped on a card: a note card gets it in its frontmatter, a text card keeps it on the node
    const cardAt = (t: EventTarget | null) => {
      const el = (t as HTMLElement).closest<HTMLElement>('.canvas-node')
      const n = el && this.node(el.dataset.id!)
      return n && n.type !== 'group' ? { el, n } : null
    }
    const unmark = () => this.world.querySelectorAll('.is-tag-target').forEach((x) => x.removeClass('is-tag-target'))
    w.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(TAG_MIME)) return
      unmark()
      const hit = cardAt(e.target)
      if (!hit) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      hit.el.addClass('is-tag-target')
    })
    w.addEventListener('dragleave', (e) => { if (!w.contains(e.relatedTarget as Node)) unmark() })
    this.registerDomEvent(document, 'dragend', unmark) // a tag dropped anywhere else leaves no card outlined
    w.addEventListener('drop', (e) => {
      const tag = e.dataTransfer?.getData(TAG_MIME)
      const hit = tag && cardAt(e.target)
      if (!hit) return
      e.preventDefault()
      unmark()
      void this.addTag(hit.n, tag)
    })
    w.addEventListener('drop', (e) => {
      const file = this.app.vault.getFileByPath(e.dataTransfer?.getData('text/x-aether-path') ?? '')
      if (!file || file.extension !== 'md') return
      e.preventDefault()
      this.addFileCard(file, this.toWorld(e.clientX, e.clientY))
    })
  }

  /** Focus the canvas without the keyboard focus ring (after Escape or a click); Tab brings the ring back. */
  private focusQuietly() {
    this.wrapper.addClass('no-ring')
    this.wrapper.focus({ preventScroll: true })
    const back = (ev: Event) => {
      if (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Tab') return
      this.wrapper.removeClass('no-ring')
      this.wrapper.removeEventListener('keydown', back)
      this.wrapper.removeEventListener('blur', back)
    }
    this.wrapper.addEventListener('keydown', back)
    this.wrapper.addEventListener('blur', back)
  }

  private onPointerDown(e: PointerEvent) {
    this.glide = null // a press takes the view over from a wheel glide
    if (this.editing || (e.button !== 0 && e.button !== 1)) return
    const target = e.target as HTMLElement
    if (target.closest('a, textarea')) return
    // a drag on the canvas is never a text selection (connecting cards used to select the whole page)
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    // preventDefault also stops the browser from focusing the canvas: do it ourselves so its shortcuts keep working
    if (!this.wrapper.contains(document.activeElement)) this.focusQuietly()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    let onMove: (dx: number, dy: number, ev: PointerEvent) => void = () => {}
    let onUp: (ev: PointerEvent) => void = () => {}
    /** Escape during the gesture: put everything back as it was. */
    let onCancel: () => void = () => {}
    const nodeEl = target.closest<HTMLElement>('.canvas-node')
    const n = nodeEl ? this.node(nodeEl.dataset.id!)! : null
    const edgeEl = target.closest('.canvas-edge') as SVGGElement | null
    const strokeEl = target.closest('.canvas-stroke') as SVGGElement | null
    const mod = e.ctrlKey || e.metaKey

    if (this.drawing && e.button === 0 && !mod) {
      const points: [number, number][] = []
      const live = this.strokesEl.appendChild(document.createElementNS(SVG, 'path'))
      live.classList.add('canvas-stroke-path')
      live.setAttribute('stroke-width', String(STROKE_WIDTH))
      live.style.color = inkColor()
      const add = (ev: PointerEvent) => {
        const p = this.toWorld(ev.clientX, ev.clientY)
        const last = points.at(-1)
        if (last && Math.hypot(p.x - last[0], p.y - last[1]) < 1) return
        points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])
        live.setAttribute('d', strokePath(points))
      }
      add(e)
      onMove = (_dx, _dy, ev) => add(ev)
      onUp = () => { live.remove(); if (moved && points.length > 1) this.addStroke(points) }
      onCancel = () => live.remove()
    } else if (strokeEl && mod) {
      // Ctrl / ⌘ + click: add the drawing to the selection or take it out
      const id = strokeEl.dataset.id!
      if (!this.selectedStrokes.delete(id)) this.selectedStrokes.add(id)
      this.renderStrokes()
      this.focusQuietly()
      return
    } else if (strokeEl && !this.drawing) {
      // press on a drawing: select it (unless it already is) and drag everything selected, cards too
      const id = strokeEl.dataset.id!
      if (!this.selectedStrokes.has(id)) { this.select([]); this.selectedStrokes.add(id); this.renderStrokes() }
      const moving = this.data.nodes.filter((x) => this.selected.has(x.id) && !card(x)['aether-locked'])
      const origin = moving.map((x) => ({ x: x.x, y: x.y }))
      const drag = this.dragStrokes()
      onMove = (dx, dy) => {
        moving.forEach((x, i) => { x.x = origin[i].x + dx / this.t.zoom; x.y = origin[i].y + dy / this.t.zoom; this.place(x) })
        if (moving.length) this.renderEdges()
        drag.move(dx / this.t.zoom, dy / this.t.zoom)
      }
      onUp = () => { if (moved) drag.commit() }
      onCancel = () => { moving.forEach((x, i) => { x.x = origin[i].x; x.y = origin[i].y; this.place(x) }); this.renderEdges(); drag.move(0, 0) }
      this.focusQuietly()
    } else if (n && target.hasClass('canvas-node-connection-point')) {
      const side = target.dataset.side as Side
      const temp = document.createElementNS(SVG, 'path')
      temp.classList.add('canvas-edge-path', 'is-drafting')
      this.edgesEl.appendChild(temp)
      // while dragging: the card under the cursor is outlined, the side the arrow will enter lights up,
      // and the line snaps to it; a path that already exists shows as a faded line and a struck target
      let lit: HTMLElement[] = []
      const unlight = () => { for (const x of lit) x.removeClass('is-connect-target', 'is-connect-dup', 'is-snap'); lit = []; temp.removeClass('is-duplicate') }
      onMove = (_dx, _dy, ev) => {
        unlight()
        const p = this.toWorld(ev.clientX, ev.clientY)
        const overEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.canvas-node')
        const to = overEl && this.node(overEl.dataset.id!)
        if (overEl && to && to !== n) {
          const toSide = facingSide(to, { ...p, width: 0, height: 0 })
          const dup = hasEdge(this.data.edges, n.id, side, to.id, toSide)
          const point = overEl.querySelector<HTMLElement>(`.canvas-node-connection-point.mod-${toSide}`)
          overEl.addClass(dup ? 'is-connect-dup' : 'is-connect-target')
          lit.push(overEl)
          if (point && !dup) { point.addClass('is-snap'); lit.push(point) }
          temp.toggleClass('is-duplicate', dup)
          temp.setAttribute('d', edgePath(n, to, side, toSide).d)
        } else {
          temp.setAttribute('d', edgePath(n, { ...p, width: 0, height: 0 }, side, facingSide({ ...p, width: 0, height: 0 }, n)).d)
        }
      }
      onCancel = () => { unlight(); temp.remove() }
      onUp = (ev) => {
        unlight()
        temp.remove()
        const overEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.canvas-node')
        const to = overEl && this.node(overEl.dataset.id!)
        if (to && to !== n) {
          const p = this.toWorld(ev.clientX, ev.clientY)
          this.connect(n, to, side, facingSide(to, { ...p, width: 0, height: 0 }))
        }
      }
    } else if (n && card(n)['aether-locked'] && !target.hasClass('canvas-node-connection-point')) {
      // a pinned card is selected, never moved or resized
      if (!this.selected.has(n.id)) this.select([n.id], e.shiftKey)
      nodeEl!.focus({ preventScroll: true })
      return
    } else if (n && target.hasClass('canvas-node-resizer')) {
      const w0 = n.width
      const h0 = n.height
      const before = this.snapshot()
      onMove = (dx, dy) => {
        n.width = Math.max(MIN_W, w0 + dx / this.t.zoom)
        n.height = Math.max(MIN_H, h0 + dy / this.t.zoom)
        this.place(n)
        this.renderEdges()
      }
      onUp = () => { if (moved) { this.checkpoint(before); this.requestSave() } }
      onCancel = () => { n.width = w0; n.height = h0; this.place(n); this.renderEdges() }
    } else if (n && (e.ctrlKey || e.metaKey)) {
      // Ctrl / ⌘ + click: add the card to the selection or take it out
      if (this.selected.has(n.id)) {
        this.selected.delete(n.id)
        this.select([...this.selected])
        this.focusQuietly() // focusing the card now would select it alone again (focusin selects)
      } else {
        this.select([n.id], true)
        nodeEl!.focus({ preventScroll: true })
      }
      return
    } else if (n) {
      if (!this.selected.has(n.id)) this.select([n.id], e.shiftKey)
      const moving = this.withGroupContents(this.data.nodes.filter((x) => this.selected.has(x.id))).filter((x) => !card(x)['aether-locked'])
      const origin = moving.map((x) => ({ x: x.x, y: x.y }))
      const before = this.snapshot()
      const drag = this.dragStrokes(before)
      onMove = (dx, dy) => {
        moving.forEach((x, i) => { x.x = origin[i].x + dx / this.t.zoom; x.y = origin[i].y + dy / this.t.zoom; this.place(x) })
        this.renderEdges()
        drag.move(dx / this.t.zoom, dy / this.t.zoom)
      }
      onUp = () => { if (moved) drag.commit() }
      onCancel = () => { moving.forEach((x, i) => { x.x = origin[i].x; x.y = origin[i].y; this.place(x) }); this.renderEdges(); drag.move(0, 0) }
      nodeEl!.focus({ preventScroll: true }) // the drag's preventDefault keeps the browser from focusing it
    } else if (edgeEl) {
      this.selected.clear()
      for (const el of this.nodeEls.values()) el.removeClass('is-selected')
      this.selectedEdge = edgeEl.dataset.id ?? null
      this.selectedStrokes.clear()
      this.renderStrokes()
      this.renderEdges()
      this.focusQuietly()
      return
    } else {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl / ⌘ + drag on the empty canvas: a box that selects every card it touches (added to the selection)
        const kept = [...this.selected]
        const keptStrokes = [...this.selectedStrokes]
        const r = this.wrapper.getBoundingClientRect()
        const box = this.wrapper.createDiv('canvas-marquee')
        const from = this.toWorld(e.clientX, e.clientY)
        onMove = (_dx, _dy, ev) => {
          const to = this.toWorld(ev.clientX, ev.clientY)
          const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y), w = Math.abs(to.x - from.x), h = Math.abs(to.y - from.y)
          Object.assign(box.style, {
            left: `${Math.min(e.clientX, ev.clientX) - r.left}px`, top: `${Math.min(e.clientY, ev.clientY) - r.top}px`,
            width: `${Math.abs(ev.clientX - e.clientX)}px`, height: `${Math.abs(ev.clientY - e.clientY)}px`,
          })
          const hit = this.data.nodes.filter((n) => n.x < x + w && n.x + n.width > x && n.y < y + h && n.y + n.height > y).map((n) => n.id)
          // a drawing is in when one of its points is inside the box
          const strokes = this.strokes.filter((s) => s.points.some(([px, py]) => px >= x && px <= x + w && py >= y && py <= y + h)).map((s) => s.id)
          this.select([...new Set([...kept, ...hit])])
          for (const id of [...keptStrokes, ...strokes]) this.selectedStrokes.add(id)
          this.renderStrokes()
        }
        onUp = () => box.remove()
        onCancel = () => { box.remove(); this.select(kept); for (const id of keptStrokes) this.selectedStrokes.add(id); this.renderStrokes() }
      } else {
        const t0 = { ...this.t }
        onMove = (dx, dy) => { this.t.x = t0.x + dx; this.t.y = t0.y + dy; this.applyTransform() }
        onUp = () => { if (!moved) { this.select([]); this.focusQuietly() } }
        onCancel = () => { this.t = t0; this.applyTransform() }
      }
    }

    this.wrapper.setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      onMove(dx, dy, ev)
    }
    const stop = () => {
      this.wrapper.removeEventListener('pointermove', move)
      this.wrapper.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', escape, true)
      if (this.wrapper.hasPointerCapture?.(e.pointerId)) this.wrapper.releasePointerCapture(e.pointerId)
    }
    const up = (ev: PointerEvent) => {
      stop()
      onUp(ev)
    }
    const escape = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      stop()
      onCancel()
    }
    this.wrapper.addEventListener('pointermove', move)
    this.wrapper.addEventListener('pointerup', up)
    window.addEventListener('keydown', escape, true)
  }

  /** Moving a group moves what is inside it. */
  private withGroupContents(nodes: CanvasNode[]) {
    const out = new Set(nodes)
    for (const n of nodes) if (n.type === 'group') for (const x of nodesInGroup(this.data, n)) out.add(x)
    return [...out]
  }

  private onKey(e: KeyboardEvent) {
    if (this.editing) return
    const nodes = this.data.nodes.filter((n) => this.selected.has(n.id))
    const mod = e.ctrlKey || e.metaKey
    const focused = this.node((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.canvas-node')?.dataset.id ?? '')
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    // by e.code, so it works on any keyboard layout (on a Ukrainian one e.key is 'я')
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault()
      if (e.code === 'KeyY' || e.shiftKey) this.redo()
      else this.undo()
    } else if (arrows[e.key] && nodes.length) {
      e.preventDefault()
      this.checkpoint()
      const step = e.shiftKey ? 50 : 10
      const [dx, dy] = arrows[e.key]
      for (const n of (e.altKey ? nodes : this.withGroupContents(nodes)).filter((x) => !card(x)['aether-locked'])) {
        if (e.altKey) { n.width = Math.max(MIN_W, n.width + dx * step); n.height = Math.max(MIN_H, n.height + dy * step) }
        else { n.x += dx * step; n.y += dy * step }
        this.place(n)
      }
      this.changed()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (nodes.length || this.selectedEdge || this.selectedStrokes.size)) {
      e.preventDefault()
      if (this.selectedStrokes.size && !nodes.length) this.removeStrokes([...this.selectedStrokes])
      else if (this.selectedEdge) {
        this.checkpoint()
        this.data.edges = this.data.edges.filter((x) => x.id !== this.selectedEdge)
        this.selectedEdge = null
        this.changed()
      } else this.removeNodes(nodes.map((n) => n.id))
    } else if (e.key === 'Enter' && focused) {
      e.preventDefault()
      void this.openOrEdit(focused)
    } else if (e.key === 'Escape' && this.drawing) {
      this.setDrawMode(false)
    } else if (e.key === 'Escape') {
      this.select([])
      this.focusQuietly()
    } else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault()
      const r = (focused ? this.nodeEls.get(focused.id)! : this.wrapper).getBoundingClientRect()
      if (focused && focused.type !== 'group') return this.openCardMenu(focused, { x: r.left + 20, y: r.top + 20 })
      const menu = focused ? this.nodeMenu(focused) : this.backgroundMenu(this.center())
      menu.showAtPosition({ x: r.left + 20, y: r.top + 20 })
    } else if (mod && e.code === 'KeyD' && nodes.length) {
      e.preventDefault()
      this.duplicate(nodes.map((n) => n.id))
    } else if (mod && (e.code === 'KeyC' || e.code === 'KeyX') && (nodes.length || this.selectedStrokes.size)) {
      e.preventDefault()
      this.copySelection(e.code === 'KeyX')
    } else if (mod && e.code === 'KeyA') {
      e.preventDefault()
      this.select(this.data.nodes.map((n) => n.id))
    } else if (e.key === 'F2' && focused) {
      e.preventDefault()
      void this.openOrEdit(focused)
    } else if (!mod && !e.altKey && !e.shiftKey && e.code === 'KeyP' && !e.repeat && !this.drawing) {
      // tap P: draw until Escape; hold P: draw only while it is held (Aether's spring-loaded tool)
      e.preventDefault()
      this.setDrawMode(true)
      const at = Date.now()
      const up = (ev: KeyboardEvent) => {
        if (ev.code !== 'KeyP') return
        window.removeEventListener('keyup', up, true)
        if (Date.now() - at > SPRING_HOLD) this.setDrawMode(false)
      }
      window.addEventListener('keyup', up, true)
    } else if (e.key === ' ' && !mod && !e.altKey) {
      e.preventDefault()
      this.app.searchFor('')
    }
  }

  // ---- Aether's card menu and clipboard ------------------------------------------------

  private openCardMenu(n: CanvasNode, at: { x: number; y: number }) {
    const many = this.targets(n).length
    const title = many > 1 ? `Вибрано карток: ${many}` : n.type === 'file' ? (this.app.vault.getFileByPath(n.file)?.basename ?? n.file) : nodeLabel(n)
    openNoteMenu(this.noteMenuHost, n, title, at, many)
  }

  /** The cards a menu action applies to: the whole selection if `n` is in it, else just `n` (frames left out). */
  private targets(n: CanvasNode): CanvasNode[] {
    if (!this.selected.has(n.id) || this.selected.size < 2) return [n]
    return this.data.nodes.filter((x) => this.selected.has(x.id) && x.type !== 'group')
  }

  private readonly noteMenuHost: NoteMenuHost = {
    patch: (n, patch) => {
      const sizing = 'width' in patch || 'height' in patch
      const cards = this.targets(n).filter((x) => !(sizing && card(x)['aether-locked']))
      if (!cards.length) return
      this.checkpoint()
      for (const c of cards) {
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete (c as Record<string, unknown>)[k]
          else (c as Record<string, unknown>)[k] = v
        }
      }
      this.renderAll()
      this.requestSave()
    },
    duplicate: (ids) => this.duplicate(ids.length === 1 ? this.targets(this.node(ids[0])!).map((x) => x.id) : ids),
    copyText: async (n) => {
      const texts = await Promise.all(this.targets(n).map(async (c) => {
        const file = c.type === 'file' ? this.app.vault.getFileByPath(c.file) : null
        return c.type === 'text' ? c.text : file ? await this.app.vault.read(file) : ''
      }))
      try { await navigator.clipboard.writeText(texts.join('\n\n')); return true } catch { return false }
    },
    openInNotes: (n) => void this.openInNotes(n),
    front: (n) => this.reorder(this.targets(n), true),
    back: (n) => this.reorder(this.targets(n), false),
    connect: (n) => new ConnectModal(this, n).open(),
    unlink: (n) => {
      const ids = new Set(this.targets(n).map((x) => x.id))
      this.checkpoint()
      this.data.edges = this.data.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode))
      this.changed()
    },
    linkCount: (n) => {
      const ids = new Set(this.targets(n).map((x) => x.id))
      return this.data.edges.filter((e) => ids.has(e.fromNode) || ids.has(e.toNode)).length
    },
    remove: (n) => this.removeNodes([...new Set([...this.selected, n.id])]),
    pickImage: (n) => void this.pickImage(n),
    removeImage: (n) => this.noteMenuHost.patch(n, { 'aether-image': undefined }),
    tags: (n) => this.cardTags(n),
    removeTag: (n, tag) => void this.removeCardTag(n, tag),
  }

  /** Copies of the cards 30px down-right, with the edges between them; the copies become the selection. */
  duplicate(ids: string[], offset = 30) {
    const nodes = this.data.nodes.filter((n) => ids.includes(n.id))
    if (!nodes.length) return
    this.pasteNodes(nodes, this.data.edges.filter((e) => ids.includes(e.fromNode) && ids.includes(e.toNode)), offset)
  }

  /** Pasted drawings: new ids, on top of everything, selected. */
  private pasteStrokes(strokes: Stroke[], offset: number) {
    this.checkpoint()
    this.select([])
    const z = this.layered().length
    for (const s of strokes) {
      const copy: Stroke = { ...JSON.parse(JSON.stringify(s)), id: newId(), z, points: s.points.map(([x, y]) => [x + offset, y + offset] as [number, number]) }
      this.strokes.push(copy)
      this.selectedStrokes.add(copy.id)
    }
    this.renderStrokes()
    this.requestSave()
  }

  private pasteNodes(nodes: CanvasNode[], edges: CanvasEdge[], offset: number) {
    this.checkpoint()
    const ids = new Map<string, string>()
    for (const n of nodes) {
      const copy = { ...JSON.parse(JSON.stringify(n)), id: newId(), x: n.x + offset, y: n.y + offset } as CanvasNode
      delete (copy as Record<string, unknown>)['aether-locked']
      ids.set(n.id, copy.id)
      this.data.nodes.push(copy)
    }
    for (const e of edges) this.data.edges.push({ ...e, id: newId(), fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! })
    this.renderAll()
    this.select([...ids.values()])
    this.requestSave()
  }

  private copySelection(cut: boolean) {
    const nodes = this.data.nodes.filter((n) => this.selected.has(n.id))
    const ids = nodes.map((n) => n.id)
    const text = nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'file' ? `[[${n.file.replace(/\.md$/, '')}]]` : n.type === 'group' ? n.label ?? '' : n.url)).join('\n\n')
    const strokes = this.strokes.filter((s) => this.selectedStrokes.has(s.id))
    boardClip = { nodes: JSON.parse(JSON.stringify(nodes)), edges: this.data.edges.filter((e) => ids.includes(e.fromNode) && ids.includes(e.toNode)), strokes: JSON.parse(JSON.stringify(strokes)), text, pasted: 0 }
    void navigator.clipboard?.writeText(text).catch(() => {})
    boardClip.cut = cut
    if (cut && strokes.length) this.removeStrokes(strokes.map((s) => s.id))
    if (cut) this.removeNodes(ids)
  }

  /** Ctrl+V: the cards copied here (each paste a step further), or text from elsewhere as a new card. */
  private onPaste(e: ClipboardEvent) {
    if (this.editing || (e.target as HTMLElement).closest?.('textarea, input')) return
    // an image copied with Ctrl+C (a screenshot, a picture from a page, or an image file in the file manager) becomes an image card
    const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (images.length) {
      e.preventDefault()
      void this.pasteImages(images).catch((err) => { console.error(err); new Notice('Не вдалося вставити фото.') })
      return
    }
    const text = e.clipboardData?.getData('text/plain') ?? ''
    e.preventDefault()
    if (boardClip && (!text || text === boardClip.text)) {
      // a cut is put back where it was the first time; a copy lands a step further each time
      const offset = 30 * (boardClip.cut ? boardClip.pasted++ : ++boardClip.pasted)
      if (boardClip.nodes.length) this.pasteNodes(boardClip.nodes, boardClip.edges, offset)
      if (boardClip.strokes.length) this.pasteStrokes(boardClip.strokes, offset)
    } else if (text.trim()) {
      const c = this.center()
      this.addNode<TextNode>({ id: newId(), type: 'text', text, x: c.x - 130, y: c.y - 70, width: 260, height: 140 })
    }
  }

  private reorder(cards: CanvasNode[], front: boolean) {
    this.checkpoint()
    this.relayer(new Set(cards.map((c) => c.id)), () => {
      this.data.nodes = this.data.nodes.filter((x) => !cards.includes(x))
      if (front) this.data.nodes.push(...cards)
      else this.data.nodes.unshift(...cards)
    }, !front)
    this.renderAll()
    this.requestSave()
  }

  /** A note card opens its note; a text card becomes a note (the card then shows that note) and opens it. */
  private async openInNotes(n: CanvasNode) {
    if (n.type === 'file') {
      const file = this.app.vault.getFileByPath(n.file)
      if (file) await this.app.workspace.getLeaf(true).openFile(file)
      return
    }
    if (n.type !== 'text') return
    const name = (n.text.split('\n')[0].replace(/^#+\s*/, '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Без назви').slice(0, 80)
    const file = await this.app.createNote(name, n.text)
    this.checkpoint()
    const raw = n as unknown as Record<string, unknown>
    delete raw.text
    raw.type = 'file'
    raw.file = file.path
    this.renderAll()
    this.requestSave()
    await this.app.workspace.getLeaf(true).openFile(file)
  }

  /** Pasted images are saved into `attachments/` and shown as JSON Canvas file cards at their own proportions. */
  private async pasteImages(files: File[]) {
    const c = this.center()
    for (const [i, f] of files.entries()) {
      const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' } as Record<string, string>)[f.type] ?? f.type.slice(6)
      // a screenshot comes as «image.png»: give it a readable name
      const name = f.name && f.name !== 'image.png' ? f.name : `Вставлене фото.${ext}`
      const path = await this.app.vault.adapter.importBytes(name, 'attachments', new Uint8Array(await f.arrayBuffer()))
      await this.app.vault.syncPath(path)
      let w = 400, h = 300
      try {
        const bmp = await createImageBitmap(f)
        const s = Math.min(1, 400 / bmp.width, 400 / bmp.height)
        w = Math.max(80, Math.round(bmp.width * s)); h = Math.max(60, Math.round(bmp.height * s))
        bmp.close()
      } catch { /* svg or an odd format: keep the default size */ }
      this.addNode<FileNode>({ id: newId(), type: 'file', file: path, x: Math.round(c.x - w / 2 + i * 30), y: Math.round(c.y - h / 2 + i * 30), width: w, height: h })
    }
  }

  /** A photo from disk is copied into the vault's attachments folder; the card keeps its path. */
  private async pickImage(n: CanvasNode) {
    const { ipcRenderer } = await import('electron')
    const src: string | null = await ipcRenderer.invoke('image:pick')
    if (!src) return
    const path = await this.app.vault.adapter.importFile(src, 'attachments')
    await this.app.vault.syncPath(path)
    const prev = card(n)['aether-image']
    this.noteMenuHost.patch(n, { 'aether-image': { file: path, fit: prev?.fit ?? 'cover', dim: prev?.dim ?? 0 } })
  }
}

/** Keyboard way to draw an edge: pick the other card from a list. */
class ConnectModal extends Modal {
  constructor(private readonly view: CanvasView, private readonly from: CanvasNode) {
    super(view.app)
  }
  onOpen() {
    this.setTitle(`З'єднати «${nodeLabel(this.from)}» з…`)
    const others = this.view.data.nodes.filter((n) => n !== this.from)
    if (!others.length) { this.contentEl.createEl('p', { text: 'На полотні немає інших карток.' }); return }
    let target = others[0].id
    new Setting(this.contentEl).setName('Картка').addDropdown((d) => {
      for (const n of others) d.addOption(n.id, nodeLabel(n))
      d.onChange((v) => { target = v })
    })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Скасувати').onClick(() => this.close()))
      .addButton((b) => b.setButtonText("З'єднати").setCta().onClick(() => {
        this.close()
        this.view.connect(this.from, this.view.data.nodes.find((n) => n.id === target)!)
      }))
  }
}

/** Keyboard way to add a note card (the mouse way is dragging it from the file tree). */
export class AddNoteModal extends Modal {
  constructor(private readonly view: CanvasView, private readonly at?: { x: number; y: number }) {
    super(view.app)
  }
  onOpen() {
    this.setTitle('Додати нотатку на полотно')
    const notes = this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path))
    if (!notes.length) { this.contentEl.createEl('p', { text: 'У сховищі ще немає нотаток.' }); return }
    let path = notes[0].path
    new Setting(this.contentEl).setName('Нотатка').addDropdown((d) => {
      for (const f of notes) d.addOption(f.path, f.path.replace(/\.md$/, ''))
      d.onChange((v) => { path = v })
    })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Скасувати').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Додати').setCta().onClick(() => {
        this.close()
        const file = this.app.vault.getFileByPath(path)
        if (file) this.view.addFileCard(file, this.at)
      }))
  }
}

