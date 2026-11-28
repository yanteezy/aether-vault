/**
 * Backlinks for the open note (Obsidian's core `backlink` view): every note that links here,
 * with the lines that hold the links. Lives in the right sidebar.
 */
import type { TFile } from '../../core/vault/files.js'
import { ItemView, type WorkspaceLeaf } from '../workspace.js'

export class BacklinksView extends ItemView {
  override icon = 'links-coming-in'
  private listEl: HTMLElement

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.listEl = this.contentEl.createDiv('backlink-pane')
  }
  getViewType() { return 'backlink' }
  getDisplayText() { return 'Зворотні посилання' }

  async onOpen() {
    this.registerEvent(this.app.workspace.on('file-open', () => void this.render()))
    this.registerEvent(this.app.metadataCache.on('resolved', () => void this.render()))
    await this.render()
  }

  /** Notes that link to `file`, with the text of each linking line. */
  async backlinks(file: TFile) {
    const cache = this.app.metadataCache
    const out: { source: TFile; lines: string[] }[] = []
    for (const [path, targets] of Object.entries(cache.resolvedLinks)) {
      if (!targets[file.path] || path === file.path) continue
      const source = this.app.vault.getFileByPath(path)
      if (!source) continue
      const text = (await this.app.vault.cachedRead(source)).split('\n')
      const links = [...(cache.getFileCache(source)?.links ?? []), ...(cache.getFileCache(source)?.embeds ?? [])]
      const lineNos = new Set(links.filter((l) => cache.getFirstLinkpathDest(l.link, path) === file).map((l) => l.position.start.line))
      out.push({ source, lines: [...lineNos].sort((a, b) => a - b).map((n) => text[n].trim()) })
    }
    return out.sort((a, b) => a.source.basename.localeCompare(b.source.basename))
  }

  private async render() {
    const file = this.app.workspace.getActiveFile()
    const list = file ? await this.backlinks(file) : []
    this.listEl.empty()
    if (!file) return void this.listEl.createDiv({ cls: 'pane-empty', text: 'Відкрийте нотатку.' })
    this.listEl.createDiv({ cls: 'backlink-count', text: list.length ? `Посилаються на «${file.basename}»: ${list.length}` : `На «${file.basename}» ще ніхто не посилається.` })
    for (const { source, lines } of list) {
      const item = this.listEl.createDiv('tree-item search-result')
      item.createEl('button', { cls: 'tree-item-self search-result-file-title is-clickable', text: source.basename })
        .addEventListener('click', (e) => void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey).openFile(source))
      for (const line of lines) item.createDiv({ cls: 'search-result-file-match', text: line })
    }
  }
}
