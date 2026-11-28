/**
 * Disk access for one vault folder, a subset of Obsidian's `DataAdapter` / `FileSystemAdapter`.
 * Runs in the renderer with Node integration, like Obsidian.
 */
import { constants as fsConstants, promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FileStats } from './files.js'

export interface ListedFiles {
  files: string[]
  folders: string[]
}

let tmpCounter = 0

/** On Windows an antivirus or indexer may hold the target for a moment: EPERM / EBUSY then pass, so try again briefly. */
async function renameRetrying(from: string, to: string, tries = 6): Promise<'ok' | 'source-gone'> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return 'ok'
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // a retried rename whose source is gone: Windows may report EPERM although the earlier attempt went through;
      // the caller checks the target's content before it believes that
      if (i > 0 && code === 'ENOENT') return 'source-gone'
      if (i >= tries - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await new Promise((r) => setTimeout(r, 25 * (i + 1)))
    }
  }
}

export class FileSystemAdapter {
  constructor(private readonly basePath: string) {}

  getName() {
    return basename(this.basePath)
  }
  getBasePath() {
    return this.basePath
  }
  getFullPath(path: string) {
    return path === '/' ? this.basePath : join(this.basePath, path)
  }

  /** A URL the page can load the file from (images in notes). */
  getResourcePath(path: string) {
    return pathToFileURL(this.getFullPath(path)).href
  }

  /** Calls `cb` with the vault path of anything that changes on disk, from any program. */
  watch(cb: (path: string) => void): FSWatcher {
    return watch(this.basePath, { recursive: true }, (_event, name) => {
      if (name) cb(String(name).replaceAll(sep, '/'))
    })
  }

  async exists(path: string) {
    return fs.access(this.getFullPath(path)).then(() => true, () => false)
  }

  async stat(path: string): Promise<(FileStats & { type: 'file' | 'folder' }) | null> {
    const s = await fs.stat(this.getFullPath(path)).catch(() => null)
    if (!s) return null
    return { type: s.isDirectory() ? 'folder' : 'file', ctime: s.birthtimeMs, mtime: s.mtimeMs, size: s.size }
  }

  /** Direct children of a folder, as vault paths. */
  async list(path: string): Promise<ListedFiles> {
    const out: ListedFiles = { files: [], folders: [] }
    for (const d of await fs.readdir(this.getFullPath(path), { withFileTypes: true })) {
      const child = path === '/' ? d.name : `${path}/${d.name}`
      if (d.isDirectory()) out.folders.push(child)
      else if (d.isFile()) out.files.push(child)
    }
    return out
  }

  read(path: string) {
    return fs.readFile(this.getFullPath(path), 'utf8')
  }

  private readonly writes = new Map<string, Promise<void>>()

  /**
   * Writes a temp file and renames it over the target, so a crash never leaves half a note.
   * Writes to one file run one after another: on Windows two renames onto one file at once fail with EPERM.
   */
  write(path: string, data: string): Promise<void> {
    const full = this.getFullPath(path)
    const run = async () => {
      const tmp = `${full}.${process.pid}.${++tmpCounter}.tmp`
      await fs.writeFile(tmp, data, 'utf8')
      const result = await renameRetrying(tmp, full).catch(async (e) => {
        await fs.rm(tmp, { force: true })
        throw e
      })
      if (result === 'source-gone' && (await fs.readFile(full, 'utf8').catch(() => null)) !== data) {
        throw new Error(`Не вдалося записати ${path}: тимчасовий файл зник до перейменування`)
      }
    }
    const next = (this.writes.get(full) ?? Promise.resolve()).catch(() => {}).then(run)
    this.writes.set(full, next)
    void next.finally(() => { if (this.writes.get(full) === next) this.writes.delete(full) }).catch(() => {})
    return next
  }

  /** Fails if the parent folder is missing. */
  async writeNew(path: string, data: string) {
    await fs.writeFile(this.getFullPath(path), data, { encoding: 'utf8', flag: 'wx' })
  }

  /** Copies a file from anywhere on disk into `folder` of the vault under a free name; returns its vault path. */
  async importFile(source: string, folder: string): Promise<string> {
    return this.placeNew(basename(source), folder, (full) => fs.copyFile(source, full, fsConstants.COPYFILE_EXCL))
  }

  /** Writes bytes (a pasted image) as a new file in `folder` under a free name; returns its vault path. */
  async importBytes(name: string, folder: string, data: Uint8Array): Promise<string> {
    return this.placeNew(name, folder, (full) => fs.writeFile(full, data, { flag: 'wx' }))
  }

  /** Tries `name`, then `name 1`, `name 2`… until `write` (which must fail with EEXIST on a taken name) succeeds. */
  private async placeNew(name: string, folder: string, write: (full: string) => Promise<void>): Promise<string> {
    await this.mkdir(folder)
    const dot = name.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    for (let i = 0; ; i++) {
      const path = `${folder}/${stem}${i ? ` ${i}` : ''}${ext}`
      try {
        await write(this.getFullPath(path)) // never overwrite
        return path
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }

  async mkdir(path: string) {
    await fs.mkdir(this.getFullPath(path), { recursive: true })
  }

  async remove(path: string) {
    await fs.rm(this.getFullPath(path))
  }

  async rmdir(path: string, recursive: boolean) {
    const full = this.getFullPath(path)
    await (recursive ? fs.rm(full, { recursive: true }) : fs.rmdir(full))
  }

  async rename(from: string, to: string) {
    // refuse instead of silently replacing another file
    if (await this.exists(to)) throw new Error(`Destination file already exists: ${to}`)
    await fs.rename(this.getFullPath(from), this.getFullPath(to))
  }

  /** Moves to `<vault>/.trash`, like Obsidian's "trash local". Returns where it went. */
  async trashLocal(path: string): Promise<string> {
    await this.mkdir('.trash')
    let target = `.trash/${basename(path)}`
    for (let i = 1; await this.exists(target); i++) target = `.trash/${i} ${basename(path)}`
    await fs.rename(this.getFullPath(path), this.getFullPath(target))
    return target
  }
}
