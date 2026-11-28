/**
 * «Резервні копії»: the vault packed into one `.aetherbackup` file that only this app opens.
 *  - 'all': every file of the vault — notes, canvases, photos and other attachments, settings (.obsidian / .aether);
 *  - 'notes': only notes (.md) and canvases (.canvas).
 * Never packed: the trash, .git, node_modules and caches that are rebuilt anyway. The vault itself is only read.
 *
 * File: "AETHERBK" · version 1 · 12-byte IV · 16-byte GCM tag · AES-256-GCM(ZIP). Inside the ZIP, next to the
 * vault's files, `.aether-backup.json` says what the copy is. The key is built into the app: this locks the format
 * to the app and catches any damaged byte (GCM), it is not a password — anyone with the app's source can open it.
 */
import { promises as fs } from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { crc32, deflateRaw, inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

export type BackupMode = 'all' | 'notes'
export interface BackupResult { files: number; bytes: number }
export interface BackupMeta { app: 'aether'; v: 1; vault: string; mode: BackupMode; created: string; files: number }

export const BACKUP_EXT = 'aetherbackup'
const MAGIC = Buffer.from('AETHERBK', 'ascii')
const KEY = createHash('sha256').update('aether-prototype · backup · v1').digest()
const META = '.aether-backup.json'
const deflate = promisify(deflateRaw)
const inflate = promisify(inflateRaw)
const SKIP_DIRS = new Set(['.trash', '.git', 'node_modules'])
const SKIP_FILES = new Set(['.aether/galaxy-cache.json'])
const isNote = (p: string) => /\.(md|canvas)$/i.test(p)

/** Vault files to pack, as vault paths with `/`. */
export async function backupFiles(root: string, mode: BackupMode): Promise<string[]> {
  const out: string[] = []
  const visit = async (dir: string) => {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      const path = relative(root, full).split(sep).join('/')
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (mode === 'notes' && e.name.startsWith('.'))) continue // notes only: no settings folders
        await visit(full)
      } else if (e.isFile() && !SKIP_FILES.has(path) && (mode === 'all' || isNote(path))) out.push(path)
    }
  }
  await visit(root)
  return out.sort()
}

/** MS-DOS date and time for the ZIP headers (local time, 2-second steps). */
function dosTime(d: Date): [number, number] {
  const year = Math.max(1980, d.getFullYear())
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()]
}

/**
 * A ZIP (deflate, UTF-8 names) of the given entries.
 * shortcut: plain ZIP32 kept in memory — up to 65 535 files and 4 GB; switch to ZIP64 + streams past that.
 */
async function zip(entries: { path: string; data: Buffer; mtime: Date }[]): Promise<Buffer> {
  if (entries.length > 0xffff) throw new Error('Забагато файлів для однієї копії (понад 65 535).')
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const { path, data, mtime } of entries) {
    const packed = await deflate(data)
    const stored = packed.length >= data.length // already compressed (photos): keep as is
    const body = stored ? data : packed
    const name = Buffer.from(path, 'utf8')
    const crc = crc32(data) >>> 0
    const [time, date] = dosTime(mtime)
    if (offset + 30 + name.length + body.length > 0xffffffff) throw new Error('Копія вийшла б більшою за 4 ГБ.')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(stored ? 0 : 8, 8)
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12)
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(stored ? 0 : 8, 10)
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14)
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42)
    parts.push(head, name, body); central.push(cen, name)
    offset += 30 + name.length + body.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}

/** Entries of a ZIP written by `zip` (central directory, stored or deflate), checked against their CRC. */
async function unzip(buf: Buffer): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  const end = buf.length - 22
  if (end < 0 || buf.readUInt32LE(end) !== 0x06054b50) throw new Error('bad zip')
  let at = buf.readUInt32LE(end + 16)
  for (let k = 0, n = buf.readUInt16LE(end + 10); k < n; k++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip')
    const method = buf.readUInt16LE(at + 10), crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const local = buf.readUInt32LE(at + 42)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const body = buf.subarray(start, start + size)
    const data = method === 8 ? await inflate(body) : Buffer.from(body)
    if ((crc32(data) >>> 0) !== crc) throw new Error('bad crc')
    out.set(name, data)
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return out
}

function seal(plain: Buffer): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', KEY, iv)
  const body = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([MAGIC, Buffer.from([1]), iv, c.getAuthTag(), body])
}
function unseal(file: Buffer): Buffer {
  if (file.length < 37 || !file.subarray(0, 8).equals(MAGIC)) throw new Error('Це не резервна копія Aether.')
  if (file[8] !== 1) throw new Error('Цю копію створила новіша версія Aether. Оновіть застосунок.')
  const d = createDecipheriv('aes-256-gcm', KEY, file.subarray(9, 21))
  d.setAuthTag(file.subarray(21, 37))
  try { return Buffer.concat([d.update(file.subarray(37)), d.final()]) } catch { throw new Error('Файл копії пошкоджений.') }
}

/** Writes the backup to `target`; a failed write never leaves half a backup under the real name. */
export async function writeBackup(root: string, mode: BackupMode, target: string, vaultName: string, now = new Date()): Promise<BackupResult> {
  const files = await backupFiles(root, mode)
  const entries = await Promise.all(files.map(async (path) => {
    const full = join(root, ...path.split('/'))
    const [data, stat] = await Promise.all([fs.readFile(full), fs.stat(full)])
    return { path, data, mtime: stat.mtime }
  }))
  const meta: BackupMeta = { app: 'aether', v: 1, vault: vaultName, mode, created: now.toISOString(), files: files.length }
  entries.push({ path: META, data: Buffer.from(JSON.stringify(meta, null, 2)), mtime: now })
  const out = seal(await zip(entries))
  const tmp = `${target}.part`
  await fs.writeFile(tmp, out)
  await fs.rename(tmp, target)
  return { files: files.length, bytes: out.length }
}

/** Opens a backup: what it is and its files. Throws a message for the user if it is not ours or damaged. */
export async function readBackup(file: string): Promise<{ meta: BackupMeta; files: Map<string, Buffer> }> {
  let files: Map<string, Buffer>
  try { files = await unzip(unseal(await fs.readFile(file))) } catch (e) {
    throw new Error(e instanceof Error && /Aether|пошкоджен/.test(e.message) ? e.message : 'Файл копії пошкоджений.')
  }
  const raw = files.get(META)
  files.delete(META)
  let meta: BackupMeta
  try { meta = JSON.parse(raw!.toString('utf8')) } catch { throw new Error('Файл копії пошкоджений.') }
  return { meta, files }
}

/** A vault path from a backup, if it is safe to write under the new folder (no `..`, no drive or absolute path). */
export function safePath(p: string): string | null {
  if (!p || p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[a-z]:/i.test(p)) return null
  const parts = p.split('/')
  return parts.some((s) => !s || s === '.' || s === '..' || /[<>:"|?*]/.test(s)) ? null : p
}
const folderName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() || 'Сховище'

/**
 * Restores a backup as a NEW vault: a new folder under `parent` named after the vault (« (2)», « (3)» … if taken).
 * Nothing that exists is ever overwritten.
 */
export async function importBackup(file: string, parent: string): Promise<{ path: string; files: number; meta: BackupMeta }> {
  const { meta, files } = await readBackup(file)
  const base = folderName(meta.vault)
  let path = join(parent, base)
  for (let k = 2; await fs.stat(path).then(() => true, () => false); k++) path = join(parent, `${base} (${k})`)
  await fs.mkdir(path, { recursive: true })
  let written = 0
  for (const [p, data] of files) {
    const safe = safePath(p)
    if (!safe) continue // a path that would leave the new folder is skipped, never written
    const full = join(path, ...safe.split('/'))
    await fs.mkdir(join(full, '..'), { recursive: true })
    await fs.writeFile(full, data, { flag: 'wx' })
    written++
  }
  return { path, files: written, meta }
}
