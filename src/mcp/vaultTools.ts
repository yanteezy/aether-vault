/**
 * What the MCP server lets Claude see in a vault — read-only, never writes.
 * Plain Node (fs + path), no Electron: the server runs as its own process, also when the app is closed.
 */
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { nodesInGroup, parseCanvas, type CanvasData, type CanvasNode } from '../core/canvas/canvasData.js'

const MAX_NOTE = 200_000 // characters returned for one note
const MAX_HITS = 50
const PRESET_COLORS: Record<string, string> = { '1': 'red', '2': 'orange', '3': 'yellow', '4': 'green', '5': 'cyan', '6': 'purple' }

/** A path inside the vault, or an error: no `..`, no absolute paths, no symlinks pointing outside. */
export async function inVault(vault: string, rel: string): Promise<string> {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('path is required')
  const root = await fs.realpath(vault)
  const full = resolve(root, rel.replace(/^[/\\]+/, ''))
  const real = await fs.realpath(full).catch(() => { throw new Error(`not found: ${rel}`) })
  if (real !== root && !real.startsWith(root + sep)) throw new Error('path is outside the vault')
  return real
}

const hidden = (name: string) => name.startsWith('.') || name === 'node_modules'

/** Every note, canvas and attachment path (vault-relative, forward slashes); hidden folders (.aether, .trash, .git…) skipped. */
export async function listFiles(vault: string, folder = ''): Promise<string[]> {
  const root = await fs.realpath(vault)
  const start = folder ? await inVault(vault, folder) : root
  const out: string[] = []
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (hidden(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'))
    }
  }
  await walk(start)
  return out.sort((a, b) => a.localeCompare(b))
}

export async function readNote(vault: string, path: string): Promise<string> {
  const text = await fs.readFile(await inVault(vault, path), 'utf8')
  return text.length > MAX_NOTE ? `${text.slice(0, MAX_NOTE)}\n\n[… cut: the note has ${text.length} characters]` : text
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim().slice(0, 60) ?? ''
const colorName = (c?: string) => (c ? PRESET_COLORS[c] ?? c : '')

/** A canvas as a readable outline: cards with their text, frames with what they hold, connections, and Aether's card extras. */
export async function readCanvas(vault: string, path: string, selected: string[] = []): Promise<string> {
  const data: CanvasData = parseCanvas(await fs.readFile(await inVault(vault, path), 'utf8'))
  const title = (n: CanvasNode | undefined) => {
    if (!n) return '(missing card)'
    if (n.type === 'text') return `"${firstLine(n.text) || 'empty card'}"`
    if (n.type === 'file') return `note "${n.file}"`
    if (n.type === 'link') return `link ${n.url}`
    return `frame "${n.label ?? ''}"`
  }
  const lines = [`Canvas ${path}: ${data.nodes.length} cards, ${data.edges.length} connections.`, '']
  for (const n of data.nodes) {
    const extra = n as CanvasNode & Record<string, unknown>
    const facts = [`${n.type} at (${Math.round(n.x)}, ${Math.round(n.y)}), ${Math.round(n.width)}×${Math.round(n.height)}`]
    if (n.color) facts.push(`color ${colorName(n.color)}`)
    if (Array.isArray(extra['aether-tags']) && extra['aether-tags'].length) facts.push(`tags ${(extra['aether-tags'] as string[]).join(' ')}`)
    if (extra['aether-style']) facts.push(`style ${extra['aether-style']}`)
    if (extra['aether-locked']) facts.push('pinned')
    if (selected.includes(n.id)) facts.push('SELECTED')
    lines.push(`- [${n.id}] ${title(n)} — ${facts.join(', ')}`)
    if (n.type === 'text' && n.text.trim()) lines.push(...n.text.trim().split('\n').map((l) => `    ${l}`))
    if (n.type === 'group') {
      const inside = nodesInGroup(data, n).map((c) => c.id)
      if (inside.length) lines.push(`    contains: ${inside.join(', ')}`)
    }
    if (n.type === 'file') {
      const note = await readNote(vault, n.file).catch(() => null)
      if (note !== null && /\.md$/i.test(n.file)) lines.push(...note.slice(0, 600).trim().split('\n').map((l) => `    ${l}`), ...(note.length > 600 ? ['    […]'] : []))
    }
  }
  if (data.edges.length) {
    lines.push('', 'Connections:')
    const byId = new Map(data.nodes.map((n) => [n.id, n]))
    for (const e of data.edges) {
      const ends = `${title(byId.get(e.fromNode))} (${e.fromSide ?? 'auto'}) → ${title(byId.get(e.toNode))} (${e.toSide ?? 'auto'})`
      lines.push(`- ${ends}${e.label ? ` — "${e.label}"` : ''}${e.color ? `, color ${colorName(e.color)}` : ''}`)
    }
  }
  return lines.join('\n')
}

/** Notes and canvas cards containing `query` (case-insensitive), with a short snippet around each hit. */
export async function search(vault: string, query: string): Promise<string> {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) throw new Error('query is required')
  const hits: string[] = []
  const snippet = (text: string, at: number) => text.slice(Math.max(0, at - 60), at + q.length + 80).replace(/\s+/g, ' ').trim()
  for (const path of await listFiles(vault)) {
    if (hits.length >= MAX_HITS) break
    const ext = extname(path).toLowerCase()
    if (ext !== '.md' && ext !== '.canvas') continue
    const text = await fs.readFile(join(await fs.realpath(vault), path), 'utf8').catch(() => '')
    if (ext === '.md') {
      const at = text.toLowerCase().indexOf(q)
      if (at >= 0 || basename(path).toLowerCase().includes(q)) hits.push(`${path}: ${at >= 0 ? snippet(text, at) : '(name matches)'}`)
    } else {
      let data: CanvasData
      try { data = parseCanvas(text) } catch { continue }
      for (const n of data.nodes) {
        const own = n.type === 'text' ? n.text : n.type === 'group' ? n.label ?? '' : ''
        const at = own.toLowerCase().indexOf(q)
        if (at >= 0) hits.push(`${path} card [${n.id}]: ${snippet(own, at)}`)
      }
    }
  }
  return hits.length ? hits.join('\n') : `Nothing found for "${query}".`
}

/** What the app shows right now (from `.aether/workspace.json`, which the app keeps up to date). */
export async function currentView(vault: string): Promise<string> {
  let saved: { tabs?: { file?: string | null }[]; active?: number; selection?: { canvas?: string; cards?: string[] } } = {}
  try { saved = JSON.parse(await fs.readFile(join(await fs.realpath(vault), '.aether', 'workspace.json'), 'utf8')) } catch { /* app never opened here */ }
  const tabs = (saved.tabs ?? []).map((t) => t?.file).filter((f): f is string => typeof f === 'string')
  if (!tabs.length) return 'No open tabs recorded (the app has not opened this vault yet, or every tab is empty).'
  const active = tabs[saved.active ?? -1] ?? tabs.at(-1)
  const lines = [`Open tabs: ${tabs.join(', ')}`, `Active: ${active}`]
  const sel = saved.selection
  if (sel?.canvas && sel.cards?.length) {
    lines.push(`Selected on ${sel.canvas}: ${sel.cards.join(', ')}`)
    lines.push('', await readCanvas(vault, sel.canvas, sel.cards).catch((e) => `(cannot read ${sel.canvas}: ${(e as Error).message})`))
  }
  return lines.join('\n')
}
