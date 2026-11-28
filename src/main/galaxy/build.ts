/**
 * Builds the Galaxy of a vault in plain Node (it runs in a worker thread, off the main process):
 * walk the notes and the canvases, read only those changed since the cache, parse [[links]] and tags with the
 * app's own parser, resolve links, count connections, place every star (src/core/galaxy/layout.ts) and pack
 * typed arrays. Stars are the notes (.md) and the text cards of every canvas — a card needs no file of its own.
 * The cache is one service file, `.aether/galaxy-cache.json`; notes and canvases are never written.
 */
import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parseMarkdown } from '../../core/metadata/parse.js'
import { getAllTags } from '../../core/metadata/tags.js'
import { parseCanvas } from '../../core/canvas/canvasData.js'
import { groupColor, groupsOf, positionFor, starBrightness, starColor, starSize, type NoteGroups } from '../../core/galaxy/layout.js'
import type { GalaxyData, GalaxyLabel, GalaxyLayout } from '../../core/galaxy/types.js'

const CACHE = join('.aether', 'galaxy-cache.json')
const CACHE_VERSION = 2 // 2: canvas cards are stars too
const LAYOUTS: GalaxyLayout[] = ['disk', 'folders', 'tags']

/** What the cache keeps per note: enough to skip reading it again, and its coordinates. */
interface CachedNote { mtime: number; size: number; links: string[]; tags: string[]; pos: number[] }
/** A text card of a canvas: its star, its links and tags. */
interface CachedCard { id: string; name: string; links: string[]; tags: string[]; pos: number[] }
/** Per canvas: its text cards, the cards that show a note (id → note path), and its arrows (card id pairs). */
interface CachedCanvas { mtime: number; size: number; cards: CachedCard[]; files: Record<string, string>; arrows: [string, string][] }
interface Cache { v: number; notes: Record<string, CachedNote>; canvases: Record<string, CachedCanvas> }

interface Found { path: string; mtime: number; size: number }

async function walk(root: string): Promise<{ notes: Found[]; canvases: Found[] }> {
  const notes: Found[] = [], canvases: Found[] = []
  const visit = async (dir: string) => {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    const stats: Promise<void>[] = []
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue // .aether, .trash, .git, .obsidian
      const full = join(dir, e.name)
      const lower = e.name.toLowerCase()
      if (e.isDirectory()) stats.push(visit(full))
      else if (e.isFile() && (lower.endsWith('.md') || lower.endsWith('.canvas'))) {
        const list = lower.endsWith('.md') ? notes : canvases
        stats.push(fs.stat(full).then((s) => { list.push({ path: relative(root, full).split(sep).join('/'), mtime: s.mtimeMs, size: s.size }) }, () => {}))
      }
    }
    await Promise.all(stats)
  }
  await visit(root)
  const byPath = (a: Found, b: Found) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) // stable order: star i is the same every run
  return { notes: notes.sort(byPath), canvases: canvases.sort(byPath) }
}

async function readCache(root: string): Promise<Cache> {
  try {
    const c = JSON.parse(await fs.readFile(join(root, CACHE), 'utf8')) as Cache
    if (c?.v === CACHE_VERSION && c.notes && c.canvases) return c
  } catch { /* none yet, or unreadable: rebuild */ }
  return { v: CACHE_VERSION, notes: {}, canvases: {} }
}

/** Link targets as written, without #heading / ^block and display text. */
function linkTargets(text: string): string[] {
  const meta = parseMarkdown(text)
  const out = new Set<string>()
  for (const l of [...(meta.links ?? []), ...(meta.embeds ?? [])]) {
    const target = l.link.split('#')[0].split('^')[0].trim()
    if (target) out.add(target)
  }
  return [...out]
}
const tagsOf = (text: string) => getAllTags(parseMarkdown(text)).map((t) => t.replace(/^#/, ''))

/** Placing a star needs its key and groups only; the cache keeps the result (9 numbers: disk, folders, tags). */
function place(key: string, g: NoteGroups): number[] {
  return LAYOUTS.flatMap((l) => positionFor(l, key, g))
}

const canvasName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.canvas$/i, '')
/** A card's name: its first line without heading marks, or «Картка». */
const cardName = (text: string) => text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 60) || 'Картка'

function readCanvasCards(path: string, text: string, f: Found): CachedCanvas {
  const data = parseCanvas(text)
  const cards: CachedCard[] = []
  const files: Record<string, string> = {}
  for (const n of data.nodes) {
    if (n.type === 'text') {
      const tags = tagsOf(n.text)
      const key = `${path}#${n.id}`
      // cards gather by their canvas (the «folder» of a card) and by their own first tag
      cards.push({ id: n.id, name: cardName(n.text), links: linkTargets(n.text), tags, pos: place(key, { tag: tags[0]?.toLowerCase() ?? '', folder: canvasName(path) }) })
    } else if (n.type === 'file' && /\.md$/i.test(n.file)) files[n.id] = n.file
  }
  return { mtime: f.mtime, size: f.size, cards, files, arrows: data.edges.map((e) => [e.fromNode, e.toNode] as [string, string]) }
}

export async function buildGalaxy(root: string, now = Date.now()): Promise<GalaxyData> {
  const started = performance.now()
  const [found, cache] = await Promise.all([walk(root), readCache(root)])
  const next: Cache = { v: CACHE_VERSION, notes: {}, canvases: {} }
  let reparsed = 0

  // read only what changed since the cache (a few files at a time keeps the disk busy without flooding it)
  const changed = (f: Found, c?: { mtime: number; size: number }) => !c || c.mtime !== f.mtime || c.size !== f.size
  const queue = [
    ...found.notes.filter((f) => changed(f, cache.notes[f.path])).map((f) => ({ f, canvas: false })),
    ...found.canvases.filter((f) => changed(f, cache.canvases[f.path])).map((f) => ({ f, canvas: true })),
  ]
  let at = 0
  const reader = async () => {
    while (at < queue.length) {
      const { f, canvas } = queue[at++]
      let text = ''
      try { text = await fs.readFile(join(root, f.path), 'utf8') } catch { /* unreadable now: retried next time */ }
      if (canvas) {
        try { next.canvases[f.path] = readCanvasCards(f.path, text, f) } catch { next.canvases[f.path] = { mtime: f.mtime, size: f.size, cards: [], files: {}, arrows: [] } } // broken JSON: no cards
      } else {
        const tags = tagsOf(text)
        next.notes[f.path] = { mtime: f.mtime, size: f.size, links: linkTargets(text), tags, pos: place(f.path, groupsOf(f.path, tags)) }
      }
      reparsed++
    }
  }
  await Promise.all(Array.from({ length: 32 }, reader))
  for (const f of found.notes) next.notes[f.path] ??= cache.notes[f.path]
  for (const f of found.canvases) next.canvases[f.path] ??= cache.canvases[f.path]

  // the stars: notes first, then the cards canvas by canvas
  const notes = found.notes
  const cardStars: { canvas: Found; card: CachedCard }[] = []
  for (const cf of found.canvases) for (const card of next.canvases[cf.path].cards) cardStars.push({ canvas: cf, card })
  const n = notes.length + cardStars.length

  // resolve links like Obsidian does for plain names: exact path, else the note with that name (shortest path wins)
  const index = new Map<string, number>()
  notes.forEach((f, i) => index.set(f.path.toLowerCase(), i))
  const byName = new Map<string, number>()
  notes.forEach((f, i) => {
    const name = f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.md$/i, '').toLowerCase()
    const prev = byName.get(name)
    if (prev === undefined || f.path.length < notes[prev].path.length) byName.set(name, i)
  })
  const resolve = (link: string) => {
    const l = link.toLowerCase()
    return index.get(l) ?? index.get(`${l}.md`) ?? byName.get(l.slice(l.lastIndexOf('/') + 1).replace(/\.md$/, ''))
  }

  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set())
  const pairs: number[] = []
  const link = (i: number | undefined, j: number | undefined) => {
    if (i === undefined || j === undefined || i === j || neighbours[i].has(j)) return
    neighbours[i].add(j); neighbours[j].add(i); pairs.push(Math.min(i, j), Math.max(i, j))
  }
  notes.forEach((f, i) => { for (const l of next.notes[f.path].links) link(i, resolve(l)) })
  // cards: their [[links]], and the canvas arrows — card to card, card to the note a file card shows, note to note
  const cardIndex = new Map<string, number>()
  cardStars.forEach(({ canvas, card }, k) => cardIndex.set(`${canvas.path}#${card.id}`, notes.length + k))
  cardStars.forEach(({ card }, k) => { for (const l of card.links) link(notes.length + k, resolve(l)) })
  for (const cf of found.canvases) {
    const c = next.canvases[cf.path]
    const star = (id: string) => cardIndex.get(`${cf.path}#${id}`) ?? (c.files[id] ? index.get(c.files[id].toLowerCase()) : undefined)
    for (const [a, b] of c.arrows) link(star(a), star(b))
  }

  const data: GalaxyData = {
    count: n,
    paths: [...notes.map((f) => f.path), ...cardStars.map(({ canvas, card }) => `${canvas.path}#${card.id}`)],
    kind: new Uint8Array(n),
    names: [...notes.map((f) => f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')), ...cardStars.map(({ card }) => card.name)],
    positions: { disk: new Float32Array(n * 3), folders: new Float32Array(n * 3), tags: new Float32Array(n * 3) },
    size: new Float32Array(n),
    brightness: new Float32Array(n),
    color: new Float32Array(n * 3),
    edges: Uint32Array.from(pairs),
    degree: new Uint16Array(n),
    mtime: new Float64Array(n),
    labels: { disk: [], folders: [], tags: [] },
    stats: { ms: 0, reparsed, cached: reparsed < found.notes.length + found.canvases.length },
  }
  const groups: NoteGroups[] = []
  const fill = (i: number, key: string, pos: number[], g: NoteGroups, mtime: number) => {
    LAYOUTS.forEach((l, k) => data.positions[l].set(pos.slice(k * 3, k * 3 + 3), i * 3))
    const deg = Math.min(65535, neighbours[i].size)
    data.degree[i] = deg
    data.size[i] = starSize(deg)
    data.mtime[i] = mtime
    data.brightness[i] = starBrightness(mtime, now)
    data.color.set(starColor(key, g), i * 3)
    groups.push(g)
  }
  notes.forEach((f, i) => { const c = next.notes[f.path]; fill(i, f.path, c.pos, groupsOf(f.path, c.tags), f.mtime) })
  cardStars.forEach(({ canvas, card }, k) => {
    const i = notes.length + k
    data.kind[i] = 1
    fill(i, data.paths[i], card.pos, { tag: card.tags[0]?.toLowerCase() ?? '', folder: canvasName(canvas.path) }, canvas.mtime)
  })
  data.labels = makeLabels(data, groups)

  // the cache is a service file: written only when something changed, and never fatal
  if (reparsed || Object.keys(cache.notes).length !== notes.length || Object.keys(cache.canvases).length !== found.canvases.length) {
    try {
      await fs.mkdir(join(root, '.aether'), { recursive: true })
      await fs.writeFile(join(root, CACHE), JSON.stringify(next))
    } catch { /* read-only vault: next start just reads more */ }
  }
  data.stats.ms = Math.round(performance.now() - started)
  return data
}

/** Group names in the scene: for each layout, the 8 biggest groups, placed at their best-connected star (disk) or centre. */
function makeLabels(data: GalaxyData, groups: NoteGroups[]): Record<GalaxyLayout, GalaxyLabel[]> {
  const out: Record<GalaxyLayout, GalaxyLabel[]> = { disk: [], folders: [], tags: [] }
  for (const layout of LAYOUTS) {
    const keyOf = (g: NoteGroups) => (layout === 'folders' ? g.folder : g.tag || (layout === 'disk' ? g.folder : ''))
    const members = new Map<string, number[]>()
    groups.forEach((g, i) => { const k = keyOf(g); if (k) (members.get(k) ?? members.set(k, []).get(k)!).push(i) })
    const top = [...members].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).slice(0, 8)
    const pos = data.positions[layout]
    for (const [key, list] of top) {
      let x = 0, y = 0, z = 0
      if (layout === 'disk') {
        const hub = list.reduce((best, i) => (data.degree[i] > data.degree[best] ? i : best), list[0])
        ;[x, y, z] = [pos[hub * 3], pos[hub * 3 + 1], pos[hub * 3 + 2]]
      } else {
        for (const i of list) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2] }
        ;[x, y, z] = [x / list.length, y / list.length, z / list.length]
      }
      out[layout].push({ text: layout === 'tags' || (layout === 'disk' && groups[list[0]].tag === key) ? `#${key}` : key, x, y, z, color: groupColor(key) })
    }
  }
  return out
}
