/**
 * One vault: the file tree in memory plus read / create / modify / delete / rename,
 * with the events and method names of Obsidian's `Vault`.
 */
import { Events, type EventRef } from '../events.js'
import type { FileSystemAdapter } from './adapter.js'
import { normalizePath, TAbstractFile, TFile, TFolder } from './files.js'

export const CONFIG_DIR = '.aether'

const parentOf = (path: string) => {
  const i = path.lastIndexOf('/')
  return i < 0 ? '/' : path.slice(0, i)
}

export class Vault extends Events {
  readonly adapter: FileSystemAdapter
  readonly configDir = CONFIG_DIR
  private readonly root: TFolder
  private readonly byPath = new Map<string, TAbstractFile>()
  private readonly contents = new Map<string, string>()

  constructor(adapter: FileSystemAdapter) {
    super()
    this.adapter = adapter
    this.root = new TFolder(this, '/', null)
    this.byPath.set('/', this.root)
  }

  /** Calls `cb` for the folder and everything below it. */
  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => any) {
    cb(root)
    for (const c of [...root.children]) {
      if (c instanceof TFolder) Vault.recurseChildren(c, cb)
      else cb(c)
    }
  }

  getName() {
    return this.adapter.getName()
  }

  /** Reads the folder tree. Fires `create` for every file and folder found, as Obsidian does at startup. */
  private watcher: { close(): void } | undefined
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()
  private syncing: Promise<void> = Promise.resolve()

  /** Follows changes other programs make in the folder: they become create / modify / delete events. */
  startWatching() {
    this.watcher ??= this.adapter.watch((path) => {
      // our own writes and editors' bursts arrive as several events: wait until the path is quiet
      clearTimeout(this.pending.get(path))
      this.pending.set(path, setTimeout(() => {
        this.pending.delete(path)
        this.syncing = this.syncing.then(() => this.syncPath(path)).catch((e) => console.error(e))
      }, 150))
    })
  }
  stopWatching() {
    this.watcher?.close()
    this.watcher = undefined
    for (const t of this.pending.values()) clearTimeout(t)
    this.pending.clear()
  }

  /** @internal Brings one path in the tree in line with the disk. */
  async syncPath(path: string) {
    const p = normalizePath(path)
    if (p === '/' || p.split('/').some((s) => s.startsWith('.')) || p.endsWith('.tmp')) return
    const s = await this.adapter.stat(p)
    const known = this.byPath.get(p)
    if (!s) {
      if (known) this.forget(known)
      return
    }
    if (!known) {
      const parentPath = parentOf(p)
      if (!this.byPath.has(parentPath)) await this.syncPath(parentPath)
      const parent = this.getFolderByPath(parentPath)
      if (!parent || this.byPath.has(p)) return
      if (s.type === 'folder') {
        const folder = this.attach(new TFolder(this, p, parent))
        this.trigger('create', folder)
        await this.scan(folder)
      } else {
        const file = this.attach(new TFile(this, p, parent))
        file.stat = { ctime: s.ctime, mtime: s.mtime, size: s.size }
        this.trigger('create', file)
      }
      return
    }
    if (known instanceof TFile && s.type === 'file' && (s.mtime !== known.stat.mtime || s.size !== known.stat.size)) {
      known.stat = { ctime: s.ctime, mtime: s.mtime, size: s.size }
      this.contents.delete(p)
      this.trigger('modify', known)
    }
  }

  private stats: Promise<void>[] = []

  /** Lists the folder tree (firing `create` as it goes), then waits for every file's size and dates. */
  async load() {
    await this.scan(this.root)
    await Promise.all(this.stats.splice(0))
  }

  private async scan(folder: TFolder) {
    const { files, folders } = await this.adapter.list(folder.path)
    for (const path of folders) {
      if (path.slice(path.lastIndexOf('/') + 1).startsWith('.')) continue // config dir, .trash, .git
      const sub = this.attach(new TFolder(this, path, folder))
      this.trigger('create', sub)
      await this.scan(sub)
    }
    // the tree is complete as soon as it is listed; sizes and dates arrive while the walk goes on
    const added = files.map((path) => this.attach(new TFile(this, path, folder)))
    for (const file of added) this.trigger('create', file)
    this.stats.push(...added.map((f) => this.refreshStat(f)))
  }

  on(name: 'create' | 'modify' | 'delete', callback: (file: TAbstractFile) => any, ctx?: any): EventRef
  on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    return super.on(name, callback, ctx)
  }

  getRoot() {
    return this.root
  }
  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.byPath.get(normalizePath(path)) ?? null
  }
  getFileByPath(path: string): TFile | null {
    const f = this.getAbstractFileByPath(path)
    return f instanceof TFile ? f : null
  }
  getFolderByPath(path: string): TFolder | null {
    const f = this.getAbstractFileByPath(path)
    return f instanceof TFolder ? f : null
  }
  getAllLoadedFiles(): TAbstractFile[] {
    return [...this.byPath.values()]
  }
  getFiles(): TFile[] {
    return this.getAllLoadedFiles().filter((f): f is TFile => f instanceof TFile)
  }
  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter((f) => f.extension === 'md')
  }

  getResourcePath(file: TFile) {
    return `${this.adapter.getResourcePath(file.path)}?${file.stat.mtime}`
  }

  async read(file: TFile) {
    const text = await this.adapter.read(file.path)
    this.contents.set(file.path, text)
    return text
  }
  /** May return the text from the last read or write instead of going to disk. */
  async cachedRead(file: TFile) {
    return this.contents.get(file.path) ?? this.read(file)
  }

  async create(path: string, data: string): Promise<TFile> {
    const p = normalizePath(path)
    if (this.byPath.has(p)) throw new Error('File already exists.')
    const parent = this.folderFor(p)
    await this.adapter.writeNew(p, data)
    // the watcher may have added it already
    const seen = this.byPath.get(p)
    if (seen instanceof TFile) return seen
    const file = this.attach(new TFile(this, p, parent))
    this.contents.set(p, data)
    await this.refreshStat(file)
    this.trigger('create', file)
    return file
  }

  async createFolder(path: string): Promise<TFolder> {
    const p = normalizePath(path)
    if (this.byPath.has(p)) throw new Error('Folder already exists.')
    const parent = this.folderFor(p)
    await this.adapter.mkdir(p)
    const folder = this.attach(new TFolder(this, p, parent))
    this.trigger('create', folder)
    return folder
  }

  async modify(file: TFile, data: string) {
    await this.adapter.write(file.path, data)
    this.contents.set(file.path, data)
    await this.refreshStat(file)
    this.trigger('modify', file)
  }

  async append(file: TFile, data: string) {
    await this.modify(file, (await this.read(file)) + data)
  }

  /** Read, change and write in one step; returns the new text. */
  async process(file: TFile, fn: (data: string) => string) {
    const data = fn(await this.read(file))
    await this.modify(file, data)
    return data
  }

  /** Deletes for good. A folder that is not empty needs `force`. Prefer `trash`. */
  async delete(file: TAbstractFile, force = false) {
    if (file instanceof TFolder) {
      if (file.isRoot()) throw new Error('Cannot delete the vault root.')
      if (file.children.length && !force) throw new Error('Folder is not empty.')
      await this.adapter.rmdir(file.path, true)
    } else {
      await this.adapter.remove(file.path)
    }
    this.forget(file)
  }

  /** shortcut: always the vault's `.trash`, `system` (OS trash) is ignored; add electron `shell.trashItem` with the UI. */
  async trash(file: TAbstractFile, _system: boolean) {
    if (file === this.root) throw new Error('Cannot delete the vault root.')
    const target = await this.adapter.trashLocal(file.path)
    this.forget(file)
    return target
  }

  /** Puts a trashed file or folder back (from `trash`'s returned path); false when its place is taken. */
  async restoreFromTrash(trashPath: string, path: string) {
    if (await this.adapter.exists(path)) return false
    const parent = parentOf(normalizePath(path))
    if (parent !== '/') await this.adapter.mkdir(parent)
    await this.adapter.rename(trashPath, path)
    await this.syncPath(path)
    return true
  }

  async rename(file: TAbstractFile, newPath: string) {
    const p = normalizePath(newPath)
    if (this.byPath.has(p)) throw new Error('Destination file already exists.')
    if (file === this.root) throw new Error('Cannot rename the vault root.')
    const parent = this.folderFor(p)
    await this.adapter.rename(file.path, p)
    const old = file.parent!
    old.children = old.children.filter((c) => c !== file)
    parent.children.push(file)
    file.parent = parent

    const moved: [TAbstractFile, string][] = []
    const move = (f: TAbstractFile, path: string) => {
      moved.push([f, f.path])
      this.byPath.delete(f.path)
      const text = this.contents.get(f.path)
      this.contents.delete(f.path)
      f.setPath(path)
      this.byPath.set(path, f)
      if (text !== undefined) this.contents.set(path, text)
      if (f instanceof TFolder) for (const c of f.children) move(c, `${path}/${c.name}`)
    }
    move(file, p)
    for (const [f, oldPath] of moved) this.trigger('rename', f, oldPath)
  }

  private folderFor(path: string): TFolder {
    const parent = this.getFolderByPath(parentOf(path))
    if (!parent) throw new Error(`Folder does not exist: ${parentOf(path)}`)
    return parent
  }

  private attach<T extends TAbstractFile>(f: T): T {
    f.parent!.children.push(f)
    this.byPath.set(f.path, f)
    return f
  }

  /** Drops a file or a whole folder from the tree, firing `delete` deepest first. */
  private forget(file: TAbstractFile) {
    if (file instanceof TFolder) for (const c of [...file.children]) this.forget(c)
    file.parent!.children = file.parent!.children.filter((c) => c !== file)
    this.byPath.delete(file.path)
    this.contents.delete(file.path)
    this.trigger('delete', file)
  }

  private async refreshStat(file: TFile) {
    const s = await this.adapter.stat(file.path)
    if (s) file.stat = { ctime: s.ctime, mtime: s.mtime, size: s.size }
  }
}
