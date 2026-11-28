/**
 * Graph view (Obsidian's core `graph`): every note is a dot, every resolved link a line.
 * SVG, so each dot is focusable: Tab walks the notes, Enter opens one. Wheel pans, Ctrl+wheel zooms, drag pans.
 */
import { ItemView, type WorkspaceLeaf } from '../workspace.js'

const SVG = 'http://www.w3.org/2000/svg'
export interface Point { x: number; y: number }

/**
 * Force layout (Fruchterman–Reingold): linked notes pull together, all notes push apart.
 * Starts from `prev` where known, else on a spiral, so the picture is stable between renders.
 * Up to 1,500 notes every pair pushes apart; above that only notes in neighbouring grid cells do (a cell is wider
 * than the push is strong), which keeps a 10,000-note graph to seconds instead of minutes.
 */
export function forceLayout(n: number, edges: [number, number][], prev: (Point | undefined)[] = [], iterations = n > 1500 ? 30 : 250): Point[] {
  const k = 70
  const CELL = k * 4
  const pos = Array.from({ length: n }, (_, i) => prev[i] ?? { x: Math.cos(i * 2.39996) * 12 * Math.sqrt(i + 1), y: Math.sin(i * 2.39996) * 12 * Math.sqrt(i + 1) })
  const push = (i: number, j: number, disp: Point[]) => {
    const dx = pos[i].x - pos[j].x
    const dy = pos[i].y - pos[j].y
    const d2 = Math.max(dx * dx + dy * dy, 0.01)
    const f = (k * k) / d2
    disp[i].x += dx * f; disp[i].y += dy * f
    disp[j].x -= dx * f; disp[j].y -= dy * f
  }
  for (let it = 0; it < iterations; it++) {
    const temp = 30 * (1 - it / iterations) + 1
    const disp = pos.map(() => ({ x: 0, y: 0 }))
    if (n <= 1500) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) push(i, j, disp)
    } else {
      const grid = new Map<string, number[]>()
      pos.forEach((p, i) => {
        const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`
        const cell = grid.get(key)
        if (cell) cell.push(i); else grid.set(key, [i])
      })
      for (const [key, cell] of grid) {
        const [cx, cy] = key.split(',').map(Number)
        for (const [ox, oy] of [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1]]) {
          const other = ox || oy ? grid.get(`${cx + ox},${cy + oy}`) : cell
          if (!other) continue
          for (let a = 0; a < cell.length; a++) {
            for (let b = other === cell ? a + 1 : 0; b < other.length; b++) push(cell[a], other[b], disp)
          }
        }
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[a].x - pos[b].x
      const dy = pos[a].y - pos[b].y
      const d = Math.max(Math.hypot(dx, dy), 0.01)
      const f = d / k
      disp[a].x -= dx * f; disp[a].y -= dy * f
      disp[b].x += dx * f; disp[b].y += dy * f
    }
    for (let i = 0; i < n; i++) {
      // a weak pull to the middle keeps notes without links on screen
      disp[i].x -= pos[i].x * 0.02; disp[i].y -= pos[i].y * 0.02
      const d = Math.max(Math.hypot(disp[i].x, disp[i].y), 0.01)
      const step = Math.min(d, temp)
      pos[i].x += (disp[i].x / d) * step
      pos[i].y += (disp[i].y / d) * step
    }
  }
  return pos
}

/** The same layout on another thread, so a big graph does not freeze the window. */
function layoutInWorker(n: number, edges: [number, number][], prev: (Point | undefined)[]): Promise<Point[]> {
  // forceLayout uses nothing outside itself, so its source runs as is in the worker
  const url = URL.createObjectURL(new Blob([`const forceLayout = ${forceLayout.toString()}
onmessage = (e) => postMessage(forceLayout(...e.data))`], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return new Promise<Point[]>((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data)
    worker.onerror = (e) => reject(e)
    worker.postMessage([n, edges, prev])
  }).finally(() => { worker.terminate(); URL.revokeObjectURL(url) })
}

export class GraphView extends ItemView {
  override icon = 'git-fork'
  private readonly svg: SVGSVGElement
  private readonly world: SVGGElement
  private positions = new Map<string, Point>()
  private t = { x: 0, y: 0, zoom: 1 }
  private fitted = false
  private renderQueued = false

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.contentEl.addClass('graph-view')
    this.svg = document.createElementNS(SVG, 'svg')
    this.svg.classList.add('graph-svg')
    this.contentEl.appendChild(this.svg)
    this.world = document.createElementNS(SVG, 'g')
    this.svg.appendChild(this.world)
    this.listen()
  }
  getViewType() { return 'graph' }
  getDisplayText() { return 'Граф' }

  async onOpen() {
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.requestRender()))
    this.registerEvent(this.app.workspace.on('file-open', () => this.markActive()))
    void this.render()
  }

  private requestRender() {
    if (this.renderQueued) return
    this.renderQueued = true
    setTimeout(() => { this.renderQueued = false; void this.render() }, 100)
  }

  private neighbours = new Map<string, string[]>()
  private nodeEls = new Map<string, SVGGElement>()
  private highlightEl: SVGPathElement | null = null
  private labelEl: SVGTextElement | null = null
  private run = 0

  async render() {
    const run = ++this.run
    const files = this.app.vault.getMarkdownFiles()
    const index = new Map(files.map((f, i) => [f.path, i]))
    const pairs = new Set<string>()
    const edges: [number, number][] = []
    for (const [src, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      const a = index.get(src)
      for (const tgt of Object.keys(targets)) {
        const b = index.get(tgt)
        if (a === undefined || b === undefined || a === b) continue
        const key = a < b ? `${a}-${b}` : `${b}-${a}`
        if (!pairs.has(key)) { pairs.add(key); edges.push([a, b]) }
      }
    }
    const big = files.length > 1500
    const prev = files.map((f) => this.positions.get(f.path))
    if (big && !this.positions.size) this.svg.setAttribute('aria-busy', 'true')
    const pos = big && typeof Worker !== 'undefined' ? await layoutInWorker(files.length, edges, prev) : forceLayout(files.length, edges, prev)
    if (run !== this.run) return // a newer render started meanwhile
    this.svg.removeAttribute('aria-busy')
    this.positions = new Map(files.map((f, i) => [f.path, pos[i]]))

    const degree = files.map(() => 0)
    this.neighbours = new Map(files.map((f) => [f.path, []]))
    for (const [a, b] of edges) {
      degree[a]++; degree[b]++
      this.neighbours.get(files[a].path)!.push(files[b].path)
      this.neighbours.get(files[b].path)!.push(files[a].path)
    }

    this.world.replaceChildren()
    this.nodeEls.clear()
    this.svg.setAttribute('aria-label', `Граф: нотаток ${files.length}, зв'язків ${edges.length}`)
    // all links in one path: thousands of <line> elements are what makes a big graph slow to draw
    const links = document.createElementNS(SVG, 'path')
    links.classList.add('graph-links')
    links.setAttribute('d', edges.map(([a, b]) => `M${pos[a].x} ${pos[a].y}L${pos[b].x} ${pos[b].y}`).join(''))
    this.highlightEl = document.createElementNS(SVG, 'path')
    this.highlightEl.classList.add('graph-links', 'is-highlighted')
    this.world.append(links, this.highlightEl)
    files.forEach((f, i) => {
      const g = document.createElementNS(SVG, 'g')
      g.classList.add('graph-node')
      g.dataset.path = f.path
      g.setAttribute('tabindex', '0')
      g.setAttribute('role', 'link')
      g.setAttribute('aria-label', `${f.basename}, зв'язків: ${degree[i]}`)
      g.setAttribute('transform', `translate(${pos[i].x} ${pos[i].y})`)
      const circle = document.createElementNS(SVG, 'circle')
      circle.setAttribute('r', String(5 + Math.sqrt(degree[i]) * 2))
      g.appendChild(circle)
      if (!big) g.appendChild(this.label(f.basename, 16 + Math.sqrt(degree[i]) * 2))
      this.world.appendChild(g)
      this.nodeEls.set(f.path, g)
    })
    // a big graph has one shared label that follows the hovered / focused note
    this.labelEl = big ? this.label('', 0) : null
    if (this.labelEl) { this.labelEl.classList.add('graph-hover-label'); this.world.appendChild(this.labelEl) }
    if (!this.fitted && files.length) { this.fit(pos); this.fitted = true }
    this.apply()
    this.markActive()
  }

  private label(text: string, y: number) {
    const el = document.createElementNS(SVG, 'text')
    el.setAttribute('y', String(y))
    el.textContent = text
    return el
  }

  private fit(pos: Point[]) {
    const r = this.svg.getBoundingClientRect()
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const p of pos) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
    const zoom = r.width ? Math.min(1.5, r.width / (maxX - minX + 120), r.height / (maxY - minY + 120)) : 1
    this.t = { zoom, x: r.width / 2 - ((maxX + minX) / 2) * zoom, y: r.height / 2 - ((maxY + minY) / 2) * zoom }
  }

  private apply() {
    this.world.setAttribute('transform', `translate(${this.t.x} ${this.t.y}) scale(${this.t.zoom})`)
    this.svg.classList.toggle('show-labels', this.t.zoom > 0.6)
  }

  private markActive() {
    const path = this.app.workspace.getActiveFile()?.path
    for (const [p, g] of this.nodeEls) g.classList.toggle('is-active', p === path)
  }

  /** Hovered or focused note and its neighbours stand out. */
  private highlight(path: string | null) {
    const near = new Set(path ? [path, ...(this.neighbours.get(path) ?? [])] : [])
    const at = path ? this.positions.get(path) : undefined
    this.highlightEl?.setAttribute('d', at ? (this.neighbours.get(path!) ?? []).map((n) => { const b = this.positions.get(n)!; return `M${at.x} ${at.y}L${b.x} ${b.y}` }).join('') : '')
    this.svg.classList.toggle('is-highlighting', !!path)
    for (const p of this.highlighted) this.nodeEls.get(p)?.classList.remove('is-highlighted')
    for (const p of near) this.nodeEls.get(p)?.classList.add('is-highlighted')
    this.highlighted = near
    if (this.labelEl) {
      this.labelEl.textContent = path ? this.app.vault.getFileByPath(path)?.basename ?? '' : ''
      if (at) { this.labelEl.setAttribute('x', String(at.x)); this.labelEl.setAttribute('y', String(at.y + 20)) }
    }
  }
  private highlighted = new Set<string>()

  /** In a new tab: the graph stays open behind it. */
  private open(path: string) {
    const file = this.app.vault.getFileByPath(path)
    if (file) void this.app.workspace.getLeaf(true).openFile(file)
  }

  private listen() {
    const nodeAt = (e: Event) => (e.target as Element).closest<SVGGElement>('.graph-node')
    this.svg.addEventListener('click', (e) => { const n = nodeAt(e); if (n) this.open(n.dataset.path!) })
    this.svg.addEventListener('keydown', (e) => { const n = nodeAt(e); if (n && e.key === 'Enter') this.open(n.dataset.path!) })
    this.svg.addEventListener('pointerover', (e) => this.highlight(nodeAt(e)?.dataset.path ?? null))
    this.svg.addEventListener('focusin', (e) => this.highlight(nodeAt(e)?.dataset.path ?? null))
    this.svg.addEventListener('pointerleave', () => this.highlight(null))
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const r = this.svg.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        const zoom = Math.min(4, Math.max(0.05, this.t.zoom * Math.exp(-e.deltaY / 300)))
        this.t = { x: px - ((px - this.t.x) / this.t.zoom) * zoom, y: py - ((py - this.t.y) / this.t.zoom) * zoom, zoom }
      } else { this.t.x -= e.deltaX; this.t.y -= e.deltaY }
      this.apply()
    }, { passive: false })
    this.svg.addEventListener('pointerdown', (e) => {
      if (nodeAt(e) || e.button !== 0) return
      const start = { x: e.clientX - this.t.x, y: e.clientY - this.t.y }
      const move = (ev: PointerEvent) => { this.t.x = ev.clientX - start.x; this.t.y = ev.clientY - start.y; this.apply() }
      const up = () => { this.svg.removeEventListener('pointermove', move); this.svg.removeEventListener('pointerup', up) }
      this.svg.setPointerCapture(e.pointerId)
      this.svg.addEventListener('pointermove', move)
      this.svg.addEventListener('pointerup', up)
    })
  }
}
