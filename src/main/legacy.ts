/**
 * Notes from the old Aether (0.2.x, Tauri): one JSON file per storage key in its data folder.
 * This only READS that folder; it never writes, moves or deletes anything there.
 *
 * Each old workspace becomes a vault folder with `Полотно.canvas` (the board this app opens first):
 *  - a note → a text card with the same type, title alignment, font, size, colour, photo, pin and tags;
 *    a link note → a link card; its photo is copied to `attachments/`;
 *  - an arrow → an edge, a frame → a group, a drawing → a stroke (`.aether/canvas-extra/Полотно.canvas.json`);
 *  - tag buttons have no place here yet: they are kept in the extra file (`aether-chips`), not shown.
 *
 * Old data folder: <app data>/com.aethel.vault/data, unless the user picked another one
 * (<app config>/com.aethel.vault/data-location.json → { dir }). On Windows and macOS both are the same folder.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

interface OldVault { id: string; name: string }
interface OldNote {
  id: string; title?: string; tags?: string[]; x: number; y: number; width: number; height: number
  body?: string; checklist?: { label: string; done: boolean }[]; code?: { language: string; content: string }
  color?: string; locked?: boolean; style?: string; titleAlign?: string; fontSize?: unknown; font?: string
  image?: { id: string; fit?: 'cover' | 'contain' }; link?: { url: string }
}
interface OldConnection { id: string; from: string; to: string; fromSide?: string; toSide?: string }
interface OldFrame { id: string; title?: string; x: number; y: number; width: number; height: number; color?: string; locked?: boolean }
interface OldStroke { id: string; tool?: 'pen' | 'marker'; color?: string; points: number[]; x?: number; y?: number; note?: string }

export interface LegacyVault { id: string; name: string; notes: number }
export interface LegacyData { dir: string; vaults: LegacyVault[]; active?: string }
export interface Moved { name: string; path: string; notes: number; missingImages: number }

/** The folder the old app kept its data in, if there is one. `appData` = Electron's app.getPath('appData'). */
export async function legacyDir(appData: string): Promise<string | null> {
  const base = join(appData, 'com.aethel.vault')
  let dir = join(base, 'data')
  try {
    const loc = JSON.parse(await fs.readFile(join(base, 'data-location.json'), 'utf8')) as { dir?: string }
    if (loc.dir) dir = loc.dir
  } catch { /* the default folder */ }
  try { await fs.access(join(dir, 'aether-data.json')); return dir } catch { return null }
}

/** Storage key → file name, as the old app wrote it: letters, digits, - and _ stay, the rest is %XX. */
const keyFile = (key: string) => [...Buffer.from(key, 'utf8')].map((b) => (/[A-Za-z0-9_-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('') + '.json'

async function readKey<T>(dir: string, key: string): Promise<T | undefined> {
  try { return JSON.parse(await fs.readFile(join(dir, 'data', keyFile(key)), 'utf8')) as T } catch { return undefined }
}
/** The old app's default workspace kept its keys without the `vault:<id>:` prefix. */
const vaultKey = (id: string, kind: string) => (id === 'default' ? kind : `vault:${id}:${kind}`)

export async function readLegacy(dir: string): Promise<LegacyData> {
  const list = (await readKey<OldVault[]>(dir, 'vaults')) ?? [{ id: 'default', name: 'Aether' }]
  const vaults: LegacyVault[] = []
  for (const v of list.filter((x) => x && typeof x.id === 'string')) {
    vaults.push({ id: v.id, name: v.name || 'Aether', notes: ((await readKey<OldNote[]>(dir, vaultKey(v.id, 'notes'))) ?? []).length })
  }
  return { dir, vaults, active: await readKey<string>(dir, 'active-vault') }
}

// the old colours as this app's card colours (presets where JSON Canvas has one)
const NOTE_COLOR: Record<string, string> = { accent: '#0a84ff', yellow: '3', green: '4', blue: '5', pink: '#ff6fae', purple: '6', gray: '#8e8e93' }
const FRAME_COLOR: Record<string, string> = { pink: '1', amber: '2', mint: '4', cyan: '5', lavender: '6' }
const INK: Record<string, string> = { chalk: '#ffffff', cyan: '#22d3ee', lavender: '#c084fc', amber: '#fbbf24', mint: '#34d399' }
const SIDES = new Set(['top', 'right', 'bottom', 'left'])
const r = Math.round

/** The card's Markdown: the title on the first line, then text, checklist and code as plain Markdown. */
export function cardText(n: OldNote): string {
  const parts = [n.title?.trim() || 'Без назви']
  if (n.body?.trim()) parts.push(n.body.trim())
  if (n.checklist?.length) parts.push(n.checklist.map((c) => `- [${c.done ? 'x' : ' '}] ${c.label}`).join('\n'))
  if (n.code?.content) parts.push('```' + (n.code.language || '') + '\n' + n.code.content + '\n```')
  return parts.join('\n\n')
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() || 'Aether'

async function freeFolder(parent: string, name: string) {
  let path = join(parent, safeName(name))
  for (let k = 2; await fs.stat(path).then(() => true, () => false); k++) path = join(parent, `${safeName(name)} (${k})`)
  return path
}

/** Converts one old workspace into a new vault folder under `parent` (never into an existing folder). */
export async function moveVault(dir: string, vault: LegacyVault, parent: string): Promise<Moved> {
  const notes = (await readKey<OldNote[]>(dir, vaultKey(vault.id, 'notes'))) ?? []
  const connections = (await readKey<OldConnection[]>(dir, vaultKey(vault.id, 'connections'))) ?? []
  const frames = (await readKey<OldFrame[]>(dir, vaultKey(vault.id, 'frames'))) ?? []
  const ink = (await readKey<OldStroke[]>(dir, vaultKey(vault.id, 'ink'))) ?? []
  const chips = (await readKey<unknown[]>(dir, vaultKey(vault.id, 'chips'))) ?? []

  const path = await freeFolder(parent, vault.name)
  await fs.mkdir(join(path, '.aether', 'canvas-extra'), { recursive: true })
  const images = await fs.readdir(join(dir, 'images')).catch(() => [] as string[])
  let missingImages = 0

  const nodes: Record<string, unknown>[] = []
  for (const f of frames) {
    nodes.push({ id: f.id, type: 'group', label: f.title ?? '', x: r(f.x), y: r(f.y), width: r(f.width), height: r(f.height),
      ...(f.color && FRAME_COLOR[f.color] ? { color: FRAME_COLOR[f.color] } : {}), ...(f.locked ? { 'aether-locked': true } : {}) })
  }
  const byId = new Map(notes.map((n) => [n.id, n]))
  for (const n of notes) {
    const place = { x: r(n.x), y: r(n.y), width: r(n.width), height: r(n.height) }
    const color = n.color && NOTE_COLOR[n.color] ? { color: NOTE_COLOR[n.color] } : {}
    if (n.link?.url) { nodes.push({ id: n.id, type: 'link', url: n.link.url, ...place, ...color }); continue }
    const node: Record<string, unknown> = { id: n.id, type: 'text', text: cardText(n), ...place, ...color }
    if (n.style && n.style !== 'plain') node['aether-style'] = n.style
    if (n.titleAlign && n.titleAlign !== 'center') node['aether-titleAlign'] = n.titleAlign
    if (n.font && n.font !== 'auto') node['aether-font'] = n.font
    if (n.fontSize === 'auto' || typeof n.fontSize === 'number') node['aether-fontSize'] = n.fontSize
    if (n.locked) node['aether-locked'] = true
    if (n.tags?.length) node['aether-tags'] = n.tags
    if (n.image?.id) {
      const file = images.find((f) => f.startsWith(`${n.image!.id}.`))
      if (file) {
        await fs.mkdir(join(path, 'attachments'), { recursive: true })
        await fs.copyFile(join(dir, 'images', file), join(path, 'attachments', file))
        node['aether-image'] = { file: `attachments/${file}`, ...(n.image.fit ? { fit: n.image.fit } : {}) }
      } else missingImages++
    }
    nodes.push(node)
  }
  const edges = connections.filter((c) => byId.has(c.from) && byId.has(c.to)).map((c) => ({
    id: c.id, fromNode: c.from, toNode: c.to,
    fromSide: c.fromSide && SIDES.has(c.fromSide) ? c.fromSide : 'right', toSide: c.toSide && SIDES.has(c.toSide) ? c.toSide : 'left',
  }))
  const strokes = ink.filter((s) => Array.isArray(s.points) && s.points.length >= 4).map((s) => {
    const on = s.note ? byId.get(s.note) : undefined // drawn on a note: its points are relative to that note
    const ox = (s.x ?? 0) + (on?.x ?? 0), oy = (s.y ?? 0) + (on?.y ?? 0)
    const points: [number, number][] = []
    for (let i = 0; i + 1 < s.points.length; i += 2) points.push([r((s.points[i] + ox) * 10) / 10, r((s.points[i + 1] + oy) * 10) / 10])
    const hex = s.color && (INK[s.color] ?? (/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : undefined))
    return { id: s.id, points, width: s.tool === 'marker' ? 14 : 2.5, ...(hex ? { color: s.tool === 'marker' ? `${hex}59` : hex } : {}) }
  })

  await fs.writeFile(join(path, 'Полотно.canvas'), JSON.stringify({ nodes, edges }, null, '\t'), { flag: 'wx' })
  await fs.writeFile(join(path, '.aether', 'canvas-extra', 'Полотно.canvas.json'),
    JSON.stringify({ strokes, ...(chips.length ? { 'aether-chips': chips } : {}) }, null, '\t'), { flag: 'wx' })
  return { name: vault.name, path, notes: notes.length, missingImages }
}

/** Every old workspace into its own new folder under `parent`; the active one first. */
export async function moveLegacy(data: LegacyData, parent: string): Promise<Moved[]> {
  await fs.mkdir(parent, { recursive: true })
  const order = [...data.vaults].sort((a, b) => Number(b.id === data.active) - Number(a.id === data.active))
  const out: Moved[] = []
  for (const v of order) out.push(await moveVault(data.dir, v, parent))
  return out
}
