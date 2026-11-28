/**
 * Parsed metadata of every Markdown file and the link graph, with the events of Obsidian's `MetadataCache`:
 * `changed(file, data, cache)`, `deleted(file, prevCache)`, `resolve(file)`, `resolved()`.
 * shortcut: memory only, parsed on the UI thread; move to a Web Worker + IndexedDB for 10,000-note vaults.
 */
import { Events, type EventRef } from '../events.js'
import { normalizePath, TFile, type TAbstractFile } from '../vault/files.js'
import type { Vault } from '../vault/vault.js'
import { parseMarkdown, type CachedMetadata } from './parse.js'
import { getAllTags } from './tags.js'

type LinkCounts = Record<string, Record<string, number>>

const isNote = (f: TAbstractFile): f is TFile => f instanceof TFile && f.extension === 'md'
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

export class MetadataCache extends Events {
  /** source path → target path → how many links */
  resolvedLinks: LinkCounts = {}
  /** source path → link text with no file behind it → how many */
  unresolvedLinks: LinkCounts = {}

  private readonly cache = new Map<string, CachedMetadata>()
  private readonly dirty = new Set<string>()
  private names: Map<string, TFile[]> | undefined
  private queue: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(private readonly vault: Vault) {
    super()
    vault.on('create', (f) => { this.names = undefined; this.enqueue(isNote(f) ? f : null) })
    vault.on('modify', (f) => { if (isNote(f)) this.enqueue(f) })
    vault.on('delete', (f) => {
      this.names = undefined
      const prev = this.cache.get(f.path)
      if (prev && this.cache.delete(f.path)) this.trigger('deleted', f, prev)
      this.enqueue(null)
    })
    vault.on('rename', (f, oldPath) => {
      this.names = undefined
      const data = this.cache.get(oldPath)
      this.cache.delete(oldPath)
      if (data && isNote(f)) this.cache.set(f.path, data)
      this.enqueue(isNote(f) && !data ? f : null) // renamed to .md from another extension: parse it
    })
  }

  on(name: 'changed', callback: (file: TFile, data: string, cache: CachedMetadata) => any, ctx?: any): EventRef
  on(name: 'deleted', callback: (file: TFile, prevCache: CachedMetadata | null) => any, ctx?: any): EventRef
  on(name: 'resolve', callback: (file: TFile) => any, ctx?: any): EventRef
  on(name: 'resolved', callback: () => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    return super.on(name, callback, ctx)
  }

  getFileCache(file: TFile): CachedMetadata | null {
    return this.cache.get(file.path) ?? null
  }
  /** Paths of every parsed file. */
  getCachedFiles(): string[] {
    return [...this.cache.keys()]
  }

  /** Every tag with how many times it is used, text and frontmatter together (Obsidian's internal `getTags`). */
  getTags(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const meta of this.cache.values()) for (const t of getAllTags(meta)) out[t] = (out[t] ?? 0) + 1
    return out
  }

  getCache(path: string): CachedMetadata | null {
    return this.cache.get(normalizePath(path)) ?? null
  }

  /** The file a link points to: exact path first, then a file of that name in the source's folder, then the shortest path. */
  /** The shortest link text that still finds `file` from `sourcePath`: the name, or the full path. */
  fileToLinktext(file: TFile, sourcePath: string, omitMdExtension = true): string {
    const md = omitMdExtension && file.extension === 'md'
    const name = md ? file.basename : file.name
    if (this.getFirstLinkpathDest(name, sourcePath) === file) return name
    return md ? file.path.slice(0, -3) : file.path
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    const path = linkpath.split('#')[0].trim()
    if (!path) return this.vault.getFileByPath(sourcePath)
    const want = normalizePath(path).toLowerCase()
    const name = want.slice(want.lastIndexOf('/') + 1)
    const here = folderOf(sourcePath)
    const score = (f: TFile) => {
      const p = f.path.toLowerCase()
      if (p === want || p === `${want}.md`) return 0
      return folderOf(f.path) === here ? 1 : 2
    }
    const hits = (this.nameIndex().get(name) ?? []).filter((f) => {
      const p = f.path.toLowerCase()
      return [want, `${want}.md`].some((w) => p === w || p.endsWith(`/${w}`))
    })
    hits.sort((a, b) => score(a) - score(b) || a.path.length - b.path.length)
    return hits[0] ?? null
  }

  /** @internal Resolves once everything queued so far is parsed and resolved (for tests and startup). */
  idle(): Promise<void> {
    return this.queue.then(() => this.resolving)
  }

  private resolveTimer: ReturnType<typeof setTimeout> | undefined
  private resolving: Promise<void> = Promise.resolve()
  private finishResolving = () => {}

  private enqueue(file: TFile | null) {
    this.pending++
    // reads run side by side; parsing and storing stay in order
    const read = file ? this.vault.cachedRead(file) : null
    read?.catch(() => {}) // reported below, in order
    this.queue = this.queue
      .then(async () => {
        if (!file || this.vault.getFileByPath(file.path) !== file) return
        const data = await read!
        const meta = parseMarkdown(data)
        this.cache.set(file.path, meta)
        this.dirty.add(file.path)
        this.trigger('changed', file, data, meta)
      })
      .catch((e) => console.error(e)) // one unreadable file must not stop the queue
      .then(() => { if (--this.pending === 0) this.scheduleResolve() })
  }

  /** One resolve after a burst of changes (a vault load fires thousands), not one per file. */
  private scheduleResolve() {
    if (!this.resolveTimer) this.resolving = new Promise((r) => { this.finishResolving = r })
    clearTimeout(this.resolveTimer)
    this.resolveTimer = setTimeout(() => {
      this.resolveTimer = undefined
      if (this.pending === 0) this.resolveAll()
      this.finishResolving()
    }, 30)
  }

  // shortcut: re-resolves every note once the queue drains, O(all links); track backlinks when a big vault gets slow
  private resolveAll() {
    const resolved: LinkCounts = {}
    const unresolved: LinkCounts = {}
    for (const [source, meta] of this.cache) {
      const r: Record<string, number> = (resolved[source] = {})
      const u: Record<string, number> = (unresolved[source] = {})
      for (const l of [...(meta.links ?? []), ...(meta.embeds ?? [])]) {
        const dest = this.getFirstLinkpathDest(l.link, source)
        if (dest) r[dest.path] = (r[dest.path] ?? 0) + 1
        else {
          const text = l.link.split('#')[0]
          u[text] = (u[text] ?? 0) + 1
        }
      }
    }
    this.resolvedLinks = resolved
    this.unresolvedLinks = unresolved
    for (const path of this.dirty) {
      const f = this.vault.getFileByPath(path)
      if (f) this.trigger('resolve', f)
    }
    this.dirty.clear()
    this.trigger('resolved')
  }

  /** lower-case file name, and the name without `.md` for notes → files */
  private nameIndex() {
    if (this.names) return this.names
    const names = new Map<string, TFile[]>()
    const add = (key: string, f: TFile) => { const list = names.get(key); if (list) list.push(f); else names.set(key, [f]) }
    for (const f of this.vault.getFiles()) {
      add(f.name.toLowerCase(), f)
      if (f.extension === 'md') add(f.basename.toLowerCase(), f)
    }
    return (this.names = names)
  }
}
