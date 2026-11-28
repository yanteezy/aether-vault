/**
 * «Галактика»: notes as stars in 3D. This view wires the pieces together:
 *  - data: the main process builds the graph and layout in a worker (`galaxy:load`, typed arrays);
 *  - scene: GalaxyRenderer (WebGL2, one instanced draw) seen through an OrbitCamera;
 *  - everything you read or press: GalaxyOverlay (DOM over the scene — labels, note card, dock, focus, hidden list).
 * The scene redraws only while something moves (camera animation, auto-rotation, a pointer drag).
 */
import { ItemView, type WorkspaceLeaf } from '../workspace.js'
import { OrbitCamera } from './camera.js'
import { GalaxyRenderer, type Nebula } from './renderer.js'
import { GalaxyOverlay, type Preset, type Projector } from './overlay.js'
import type { GalaxyData, GalaxyLayout } from '../../core/galaxy/types.js'

export const GALAXY_VIEW = 'galaxy'
/** how strong the lines of all connections are, under the brighter lines of a focused star */
const WEB_ALPHA = 0.3

export class GalaxyView extends ItemView {
  override icon = 'sparkles'
  private data: GalaxyData | null = null
  private layout: GalaxyLayout = 'disk'
  private renderer: GalaxyRenderer | null = null
  private readonly camera = new OrbitCamera()
  private overlay: GalaxyOverlay | null = null
  private canvas!: HTMLCanvasElement
  private frameId = 0
  private dirty = true
  private selected = -1
  private focused = -1
  private neighbours: number[][] = []
  private reloadTimer: ReturnType<typeof setTimeout> | undefined

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.contentEl.addClass('galaxy-view')
  }
  getViewType() { return GALAXY_VIEW }
  getDisplayText() { return 'Галактика' }

  async onOpen() {
    const root = this.contentEl
    root.empty()
    root.setAttr('tabindex', '0')
    root.setAttr('aria-label', 'Галактика нотаток: стрілки — сусідня зірка, Enter — відкрити, F — фокус, Escape — назад')
    this.canvas = root.createEl('canvas', { cls: 'galaxy-canvas', attr: { 'aria-hidden': 'true' } })
    const status = root.createDiv({ cls: 'galaxy-status', text: 'Будую галактику…', attr: { role: 'status' } })

    this.renderer = new GalaxyRenderer(this.canvas)
    this.overlay = new GalaxyOverlay(root, {
      onLayout: (l) => this.setLayout(l),
      onPreset: (p) => this.preset(p),
      onReset: () => { this.camera.target = [0, 0, 0]; this.preset('oblique') },
      onZoom: (f) => { this.camera.zoomAt(f, 0, 0, this.aspect()); this.changed() },
      onOpen: (i) => void this.open(i),
      onSelect: (i) => this.select(i),
      onFocus: (i) => this.focus(i),
    })
    this.applyComfort()
    this.registerDomEvent(window, 'aether:appearance', () => this.applyComfort())
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (motion) this.registerDomEvent(motion, 'change', () => this.applyComfort())

    this.listen()
    const resize = new ResizeObserver(() => this.resize())
    resize.observe(root)
    this.register(() => resize.disconnect())
    this.resize()

    // notes change: rebuild (the cache makes it cheap — only changed notes are re-read)
    for (const ev of ['create', 'modify', 'delete', 'rename'] as const) {
      this.registerEvent(this.app.vault.on(ev as 'modify', () => {
        if (!this.app.workspace.layoutReady) return // the startup scan reports every file as new: the first build already has them
        clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => void this.loadData(), 800)
      }))
    }
    this.register(() => clearTimeout(this.reloadTimer))

    if (!this.renderer.ok) status.setText('Ваш пристрій не підтримує WebGL2, тож зірки не намалювати. Список нотаток доступний з клавіатури (Tab).')
    await this.loadData()
    if (this.renderer.ok) status.remove()
    this.preset('oblique', 0)
    this.loop()
  }

  async onClose() {
    cancelAnimationFrame(this.frameId)
    this.overlay?.destroy()
    this.renderer?.dispose()
  }

  private async loadData() {
    const { ipcRenderer } = await import('electron')
    try {
      const data: GalaxyData = await ipcRenderer.invoke('galaxy:load', this.app.vault.adapter.getBasePath())
      this.data = data
      this.neighbours = Array.from({ length: data.count }, () => [])
      for (let k = 0; k < data.edges.length; k += 2) { this.neighbours[data.edges[k]].push(data.edges[k + 1]); this.neighbours[data.edges[k + 1]].push(data.edges[k]) }
      this.renderer?.setStars(data.positions[this.layout], data.size, data.brightness, data.color)
      this.renderer?.setNebulae(this.nebulae())
      if (this.focused < 0) this.renderer?.setEdges(data.edges, WEB_ALPHA) // the same connections as on the canvases and in the notes
      this.overlay?.setData(data, this.layout)
      this.showEmpty(data.count === 0)
      if (this.selected >= data.count) this.select(-1)
      this.changed()
    } catch (e) {
      console.error('galaxy:load failed', e)
      this.contentEl.querySelector('.galaxy-status')?.setText('Не вдалося побудувати галактику. Спробуйте відкрити її ще раз.')
    }
  }

  /** No notes yet: say what becomes a star and offer to make the first one, instead of an empty sky. */
  private showEmpty(on: boolean) {
    this.contentEl.querySelector('.galaxy-empty')?.remove()
    if (!on) return
    const box = this.contentEl.createDiv({ cls: 'galaxy-empty', attr: { role: 'status' } })
    box.createEl('h2', { text: 'Тут поки немає зірок' })
    box.createEl('p', { text: 'Зірками стають нотатки (файли Markdown) і текстові картки на полотнах. Створіть нотатку або додайте картку на полотно — і вона з’явиться тут.' })
    const create = box.createEl('button', { cls: 'galaxy-empty-create', text: 'Створити нотатку', attr: { type: 'button' } })
    create.addEventListener('click', () => void this.app.newNote())
  }

  /** «Зменшити прозорість» and reduced motion: no glow, no auto-rotation, no flights. */
  private applyComfort() {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const solid = document.body.hasClass('reduce-transparency')
    this.camera.reducedMotion = reducedMotion
    this.camera.autoRotate = !reducedMotion && !solid
    if (this.renderer) { this.renderer.reducedMotion = reducedMotion; this.renderer.setGlow(!reducedMotion && !solid) }
    this.changed()
  }

  private aspect() { return Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight) }
  private changed() { this.dirty = true }

  private resize() {
    this.renderer?.resize(this.canvas.clientWidth, this.canvas.clientHeight, window.devicePixelRatio || 1)
    this.changed()
  }

  /** Screen position of a world point, for the overlay. */
  private readonly project: Projector = (x, y, z) => {
    const p = this.camera.project(x, y, z, this.canvas.clientWidth, this.canvas.clientHeight)
    return { x: p.x, y: p.y, visible: p.visible }
  }

  private loop = () => {
    this.frameId = requestAnimationFrame(this.loop)
    if (!this.contentEl.isConnected || !this.data) return
    const moving = this.camera.update(performance.now()) || !!this.renderer?.animating
    this.pickHover()
    if (!moving && !this.dirty) return
    this.dirty = false
    this.renderer?.render(this.camera)
    this.overlay?.frame(this.project)
    this.overlay?.setZoomLabel(Math.round((this.camera.defaultDistance / this.camera.distance) * 100))
  }

  private hoverAt: { x: number; y: number } | null = null
  private pickHover() {
    if (!this.hoverAt || !this.renderer?.ok || !this.data) return
    const hit = this.renderer.pick(this.hoverAt.x, this.hoverAt.y, this.camera)
    this.hoverAt = null
    this.overlay?.setHover(hit)
    this.canvas.style.cursor = hit >= 0 ? 'pointer' : 'grab'
  }

  private star(i: number): [number, number, number] {
    const p = this.data!.positions[this.layout]
    return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
  }

  /** The concept's nebulae: a warm core for the disk, a cloud in its colour around each named group otherwise. */
  private nebulae(): Nebula[] {
    if (!this.data || !this.data.count) return []
    if (this.layout === 'disk') return [{ x: 0, y: 0, z: 0, rx: 125, ry: 125, color: [1, 1, 1], alpha: 1, flat: true }]
    const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255) as [number, number, number]
    return this.data.labels[this.layout].map((g) => ({ x: g.x, y: g.y, z: g.z, rx: 190, ry: 140, color: rgb(g.color), alpha: 0.38, flat: false }))
  }

  private setLayout(l: GalaxyLayout) {
    if (!this.data || l === this.layout) return
    this.layout = l
    this.renderer?.setPositions(this.data.positions[l])
    this.renderer?.setNebulae(this.nebulae())
    this.overlay?.setLayout(l)
    if (this.selected >= 0) this.camera.flyTo(this.star(this.selected))
    this.changed()
  }

  private preset(p: Preset, ms?: number) {
    this.camera.preset(p, ms)
    this.overlay?.setPreset(p)
    this.changed()
  }

  private select(i: number) {
    if (!this.data) return
    this.selected = i
    this.overlay?.setSelected(i)
    if (this.focused < 0) this.renderer?.setEmphasis(i, null)
    if (i >= 0) this.camera.flyTo(this.star(i), Math.min(this.camera.distance, 420))
    this.changed()
  }

  private focus(i: number) {
    if (!this.data) return
    this.focused = i
    if (i < 0) {
      this.renderer?.setEmphasis(this.selected, null)
      this.renderer?.setEdges(this.data.edges, WEB_ALPHA)
      this.overlay?.setFocus(-1, [])
    } else {
      const linked = this.neighbours[i]
      const pairs = new Uint32Array(linked.length * 2)
      linked.forEach((j, k) => { pairs[k * 2] = i; pairs[k * 2 + 1] = j })
      this.selected = i
      this.overlay?.setSelected(i)
      this.renderer?.setEmphasis(i, linked)
      this.renderer?.setEdges(pairs)
      this.overlay?.setFocus(i, linked)
      this.camera.flyTo(this.star(i), Math.min(this.camera.distance, 520))
    }
    this.changed()
  }

  /** A note opens in a new tab; a card opens its canvas, centred on the card. */
  private async open(i: number) {
    if (!this.data) return
    const path = this.data.paths[i]
    const card = this.data.kind[i] === 1 ? path.lastIndexOf('#') : -1
    const file = this.app.vault.getFileByPath(card >= 0 ? path.slice(0, card) : path)
    if (!file) return
    const leaf = this.app.workspace.getLeaf(true)
    await leaf.openFile(file)
    if (card >= 0) (leaf.view as { revealNode?: (id: string) => boolean }).revealNode?.(path.slice(card + 1))
  }

  private listen() {
    const c = this.canvas
    let drag: { x: number; y: number; moved: boolean; button: number } | null = null
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
      c.setPointerCapture(e.pointerId)
      this.camera.interacting = true
      this.contentEl.focus({ preventScroll: true })
    })
    c.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
        if (drag.button === 0 && !e.shiftKey) this.camera.orbit(dx, dy)
        else this.camera.pan(dx, dy, c.clientHeight)
        drag.x = e.clientX; drag.y = e.clientY
        this.changed()
        return
      }
      const r = c.getBoundingClientRect()
      this.hoverAt = { x: e.clientX - r.left, y: e.clientY - r.top } // picked once per frame, not on every mouse event
    })
    c.addEventListener('pointerup', (e) => {
      const was = drag
      drag = null
      this.camera.interacting = false
      if (!was || was.moved || !this.renderer?.ok) return
      const r = c.getBoundingClientRect()
      this.select(this.renderer.pick(e.clientX - r.left, e.clientY - r.top, this.camera))
    })
    c.addEventListener('dblclick', (e) => {
      if (!this.renderer?.ok) return
      const r = c.getBoundingClientRect()
      const hit = this.renderer.pick(e.clientX - r.left, e.clientY - r.top, this.camera)
      if (hit >= 0) void this.open(hit)
    })
    c.addEventListener('pointerleave', () => { this.hoverAt = null; this.overlay?.setHover(-1) })
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1
      const ndcY = 1 - ((e.clientY - r.top) / r.height) * 2
      this.camera.zoomAt(Math.exp(-e.deltaY / 400), ndcX, ndcY, this.aspect())
      this.changed()
    }, { passive: false })
    this.contentEl.addEventListener('keydown', (e) => {
      if (this.overlay?.handleKey(e, this.project)) { e.preventDefault(); this.changed() }
    })
  }
}
