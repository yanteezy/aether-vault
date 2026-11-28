/**
 * Left sidebar views with Obsidian's DOM: the file tree (`.nav-files-container`, `.tree-item`, `.nav-file-title`)
 * and the tag list. The search box above them filters the tree by name or by `#tag`.
 */
import { TFile, TFolder, type TAbstractFile } from '../../core/vault/files.js'
import { getAllTags } from '../../core/metadata/tags.js'
import { setIcon } from '../icons.js'
import { Notice } from '../ui.js'
import { ItemView, type WorkspaceLeaf } from '../workspace.js'
import { addTagToFile, fileMenu, moveTo, removeTagWithUndo, TAG_MIME, tagMenu, trashWithUndo } from './fileActions.js'

export class FileExplorerView extends ItemView {
  override icon = 'folder'
  private filter = ''
  private readonly collapsed = new Set<string>()
  private listEl: HTMLElement
  private renderQueued = false

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.listEl = this.contentEl.createDiv({ cls: 'nav-files-container', attr: { role: 'tree', 'aria-label': 'Файли сховища' } })
    this.listenForActions()
  }

  private fileAt(el: EventTarget | null): TAbstractFile {
    const path = (el as HTMLElement | null)?.closest?.<HTMLElement>('[data-path]')?.dataset.path
    return (path && this.app.vault.getAbstractFileByPath(path)) || this.app.vault.getRoot()
  }

  /** Context menu (right click, Shift+F10, Menu key), Delete key, and drag-and-drop into folders. */
  private listenForActions() {
    const list = this.listEl
    list.addEventListener('contextmenu', (e) => fileMenu(this.app, this.fileAt(e.target)).showAtMouseEvent(e))
    list.addEventListener('keydown', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-path]')
      if (!item) return
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        const r = item.getBoundingClientRect()
        fileMenu(this.app, this.fileAt(item)).showAtPosition({ x: r.left + 24, y: r.bottom })
      } else if (e.key === 'Delete') {
        e.preventDefault()
        void trashWithUndo(this.app, this.fileAt(item))
      }
    })
    const MIME = 'text/x-aether-path'
    // the dragged item: dragover cannot read dataTransfer, and a move into its own folder is no move
    let dragged: TAbstractFile | null = null
    list.addEventListener('dragstart', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-path]')
      if (item && e.dataTransfer) e.dataTransfer.setData(MIME, item.dataset.path!)
      dragged = item ? this.app.vault.getAbstractFileByPath(item.dataset.path!) : null
    })
    const folderAt = (t: EventTarget | null) => {
      const f = this.fileAt(t)
      return f instanceof TFolder ? f : f.parent!
    }
    // the root's highlight sits on the list itself, so clear it too
    const clear = () => { list.removeClass('is-being-dragged-over'); list.querySelectorAll('.is-being-dragged-over').forEach((el) => el.removeClass('is-being-dragged-over')) }
    // a drag that ends anywhere (on the canvas, outside, Escape) leaves nothing lit
    list.addEventListener('dragend', () => { clear(); dragged = null })
    // a tag pill dropped on a note adds the tag to it
    const noteAt = (t: EventTarget | null) => {
      const f = this.fileAt(t)
      return f instanceof TFile && f.extension === 'md' ? f : null
    }
    list.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(TAG_MIME)) return
      clear()
      const note = noteAt(e.target)
      if (!note) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      list.querySelector(`[data-path="${CSS.escape(note.path)}"]`)?.addClass('is-being-dragged-over')
    })
    list.addEventListener('drop', (e) => {
      const tag = e.dataTransfer?.getData(TAG_MIME)
      const note = tag && noteAt(e.target)
      if (!note) return
      e.preventDefault()
      clear()
      void addTagToFile(this.app, note, tag).then((added) => added && new Notice(`${tag} → ${note.basename}`))
    })
    list.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(MIME)) return
      e.preventDefault()
      clear()
      const folder = folderAt(e.target)
      if (dragged && (dragged.parent === folder || dragged === folder)) return // already there: nothing to show
      ;(folder.isRoot() ? list : list.querySelector(`[data-path="${CSS.escape(folder.path)}"]`)?.parentElement)?.addClass('is-being-dragged-over')
    })
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget as Node)) clear() })
    list.addEventListener('drop', (e) => {
      clear()
      const path = e.dataTransfer?.getData(MIME)
      const file = path && this.app.vault.getAbstractFileByPath(path)
      if (!file) return
      e.preventDefault()
      const folder = folderAt(e.target)
      if (folder !== file && !folder.path.startsWith(`${file.path}/`)) void moveTo(this.app, file, folder)
    })
  }
  getViewType() { return 'file-explorer' }
  getDisplayText() { return 'Файли' }

  async onOpen() {
    const vault = this.app.vault
    for (const ev of ['create', 'delete', 'rename'] as const) this.registerEvent(vault.on(ev as 'create', () => this.requestRender()))
    this.registerEvent(this.app.metadataCache.on('resolved', () => { if (this.filter.startsWith('#')) this.requestRender() }))
    this.registerEvent(this.app.workspace.on('file-open', () => this.markActive()))
    this.render()
  }

  /** Notes whose text contains the query → the matching line (full-text search). */
  private contentHits = new Map<string, string>()
  private searchRun = 0

  setFilter(q: string) {
    this.filter = q.trim().toLowerCase()
    this.contentHits.clear()
    this.render()
    if (this.filter.length >= 2 && !this.filter.startsWith('#')) void this.searchContent(this.filter)
  }

  /** shortcut: scans every note's text in memory; fine for thousands of notes, add an index if it gets slow. */
  private async searchContent(q: string) {
    const run = ++this.searchRun
    const hits = new Map<string, string>()
    for (const f of this.app.vault.getMarkdownFiles()) {
      const text = await this.app.vault.cachedRead(f)
      const i = text.toLowerCase().indexOf(q)
      if (i < 0) continue
      const start = text.lastIndexOf('\n', i) + 1
      const end = text.indexOf('\n', i)
      hits.set(f.path, text.slice(start, end < 0 ? undefined : end).trim())
    }
    if (run !== this.searchRun) return // a newer query is running
    this.contentHits = hits
    this.render()
  }

  /** The line with the match, the match itself in <mark>. */
  private snippet(line: string, el: HTMLElement) {
    const i = line.toLowerCase().indexOf(this.filter)
    const from = Math.max(0, i - 40)
    el.append(`${from ? '…' : ''}${line.slice(from, i)}`)
    el.createEl('mark', { text: line.slice(i, i + this.filter.length) })
    el.append(line.slice(i + this.filter.length, i + this.filter.length + 120))
  }

  private requestRender() {
    if (this.renderQueued) return
    this.renderQueued = true
    queueMicrotask(() => { this.renderQueued = false; this.render() })
  }

  private matches(f: TFile) {
    if (!this.filter) return true
    if (this.filter.startsWith('#')) {
      const cache = this.app.metadataCache.getFileCache(f)
      return !!cache && getAllTags(cache).some((t) => t.toLowerCase() === this.filter || t.toLowerCase().startsWith(`${this.filter}/`))
    }
    return f.basename.toLowerCase().includes(this.filter) || this.contentHits.has(f.path)
  }

  /** Folders first, then by name, as in Obsidian's default sort. */
  private sorted(children: TAbstractFile[]) {
    return [...children].sort((a, b) => Number(b instanceof TFolder) - Number(a instanceof TFolder) || a.name.localeCompare(b.name))
  }

  private render() {
    this.listEl.empty()
    const shown = this.renderFolder(this.app.vault.getRoot(), this.listEl, 1)
    if (!shown) this.listEl.createDiv({ cls: 'pane-empty', text: this.filter ? 'Нічого не знайдено' : 'Нотаток ще немає' })
    this.markActive()
  }

  private renderFolder(folder: TFolder, parentEl: HTMLElement, level: number): number {
    let shown = 0
    for (const child of this.sorted(folder.children)) {
      if (child instanceof TFolder) {
        const item = createDiv('tree-item nav-folder')
        const open = !!this.filter || !this.collapsed.has(child.path)
        const self = item.createEl('button', {
          cls: 'tree-item-self nav-folder-title is-clickable',
          attr: { role: 'treeitem', 'aria-expanded': open, 'aria-level': level, 'data-path': child.path, style: `--level:${level - 1}`, draggable: 'true' },
        })
        setIcon(self.createSpan('tree-item-icon collapse-icon'), 'chevron-right')
        self.createSpan({ cls: 'tree-item-inner nav-folder-title-content', text: child.name })
        item.toggleClass('is-collapsed', !open)
        self.addEventListener('click', () => {
          if (this.collapsed.has(child.path)) this.collapsed.delete(child.path)
          else this.collapsed.add(child.path)
          this.render()
          this.listEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(child.path)}"]`)?.focus() // keep keyboard focus
        })
        const kids = item.createDiv({ cls: 'tree-item-children nav-folder-children', attr: { role: 'group' } })
        const n = open ? this.renderFolder(child, kids, level + 1) : 1
        if (n || !this.filter) { parentEl.appendChild(item); shown += 1 }
      } else if (child instanceof TFile && this.matches(child)) {
        const item = parentEl.createDiv('tree-item nav-file')
        const self = item.createEl('button', {
          cls: 'tree-item-self nav-file-title is-clickable',
          attr: { role: 'treeitem', 'aria-level': level, 'data-path': child.path, style: `--level:${level - 1}`, draggable: 'true' },
        })
        self.createSpan({ cls: 'tree-item-inner nav-file-title-content', text: this.app.extensionViews.has(child.extension.toLowerCase()) ? child.basename : child.name })
        if (child.extension !== 'md') self.createSpan({ cls: 'nav-file-tag', text: child.extension === 'canvas' ? 'полотно' : child.extension })
        const hit = this.contentHits.get(child.path)
        if (hit !== undefined) this.snippet(hit, item.createDiv('search-result-file-match'))
        self.addEventListener('click', (e) => {
          if (!this.app.extensionViews.has(child.extension.toLowerCase())) return
          const leaf = this.app.workspace.getLeaf(e.ctrlKey || e.metaKey)
          // straight into the text, so Enter on a note in the tree lets you type at once
          void leaf.openFile(child).then(() => (leaf.view as { editor?: { focus(): void } }).editor?.focus())
        })
        shown += 1
      }
    }
    return shown
  }

  private markActive() {
    const path = this.app.workspace.getActiveFile()?.path
    for (const el of this.listEl.querySelectorAll<HTMLElement>('.nav-file-title')) {
      const on = el.dataset.path === path
      el.toggleClass('is-active', on)
      el.setAttr('aria-current', on ? 'page' : null)
    }
  }
}

export class TagView extends ItemView {
  override icon = 'tag'
  private listEl: HTMLElement

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.listEl = this.contentEl.createDiv('tag-container')
  }
  getViewType() { return 'tag' }
  getDisplayText() { return 'Теги' }

  async onOpen() {
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.render()))
    this.registerDomEvent(window, 'aether:tags', () => this.render())
    // right click on a pill: its menu; on the empty part of the panel: the sidebar menu
    this.registerDomEvent(this.listEl, 'contextmenu', (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('.tag-pane-item')
      if (item) tagMenu(this.app, item.dataset.tag!, Number(item.dataset.count)).showAtMouseEvent(e)
      else fileMenu(this.app, this.app.vault.getRoot()).showAtMouseEvent(e)
    })
    this.registerDomEvent(this.listEl, 'keydown', (e: KeyboardEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('.tag-pane-item')
      if (!item || !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return
      e.preventDefault()
      const r = item.getBoundingClientRect()
      tagMenu(this.app, item.dataset.tag!, Number(item.dataset.count)).showAtPosition({ x: r.left + 12, y: r.bottom })
    })
    this.render()
  }

  private render() {
    const counts = new Map<string, number>()
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f)
      if (!cache) continue
      for (const t of new Set(getAllTags(cache))) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    // hand-made tags show even without notes: this vault's own and the ones kept everywhere
    const known = new Set([...counts.keys()].map((t) => t.toLowerCase()))
    for (const t of [...this.app.tags.vaultTags(), ...this.app.tags.globalTags()]) {
      if (!known.has(t.toLowerCase())) { counts.set(t, 0); known.add(t.toLowerCase()) }
    }
    this.listEl.empty()
    if (!counts.size) this.listEl.createDiv({ cls: 'pane-empty', text: 'Тегів ще немає' })
    for (const [tag, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const everywhere = this.app.tags.isGlobal(tag)
      const item = this.listEl.createSpan({ cls: `tag-pane-item${everywhere ? ' is-global' : ''}`, attr: { 'data-tag': tag, 'data-count': n } })
      const pill = item.createEl('button', { cls: 'tag-pane-tag', attr: { 'aria-label': `${tag}, нотаток: ${n}${everywhere ? ', збережено всюди' : ''}`, title: everywhere ? 'Збережено всюди' : '' } })
      if (everywhere) setIcon(pill.createSpan('tag-pane-tag-global'), 'globe')
      pill.createSpan({ cls: 'tag-pane-tag-text', text: tag })
      pill.createSpan({ cls: 'tag-pane-tag-count', text: String(n) })
      pill.draggable = true
      pill.addEventListener('dragstart', (e) => { e.dataTransfer?.setData(TAG_MIME, tag); e.dataTransfer && (e.dataTransfer.effectAllowed = 'copy') })
      pill.addEventListener('click', () => this.app.searchFor(tag))
      // a bubble × that grows out of the pill on hover (or keyboard focus) and shrinks back into it
      const remove = item.createEl('button', { cls: 'tag-pane-remove', attr: { 'aria-label': `Прибрати тег ${tag} з усіх нотаток`, title: 'Прибрати тег' } })
      setIcon(remove, 'x')
      remove.addEventListener('click', () => void removeTagWithUndo(this.app, tag))
    }
  }
}
