/**
 * Workspace, leaves and views with Obsidian's names and DOM classes.
 * Layout: left sidebar (stacked leaves) | root (tabs) | right sidebar (stacked leaves, hidden when empty).
 * shortcut: no drag-and-drop, no splits inside the root ('split' opens a tab); add with layout saving.
 */
import { Events, type EventRef } from '../core/events.js'
import type { TFile } from '../core/vault/files.js'
import type { Extension } from '@codemirror/state'
import type { App } from './app.js'
import { Component } from './component.js'
import { hotkeyLabel } from './commands.js'
import type { MarkdownView } from './editor/markdownView.js'
import { setIcon } from './icons.js'
import type { EditorSuggest } from './editor/suggest.js'

export interface ViewState {
  type: string
  state?: Record<string, unknown>
  active?: boolean
}

export abstract class View extends Component {
  app: App
  leaf: WorkspaceLeaf
  containerEl: HTMLElement
  icon = 'document'
  navigation = false

  constructor(leaf: WorkspaceLeaf) {
    super()
    this.leaf = leaf
    this.app = leaf.app
    this.containerEl = createDiv('workspace-leaf-content')
  }
  abstract getViewType(): string
  abstract getDisplayText(): string
  getIcon() { return this.icon }
  getState(): Record<string, unknown> { return {} }
  async setState(_state: Record<string, unknown>, _result?: unknown): Promise<void> {}
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

/** `containerEl.children[0]` is the header and `children[1]` the content: many plugins rely on that. */
export abstract class ItemView extends View {
  headerEl: HTMLElement
  titleEl: HTMLElement
  actionsEl: HTMLElement
  contentEl: HTMLElement

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.headerEl = this.containerEl.createDiv('view-header')
    this.titleEl = this.headerEl.createDiv('view-header-title-container').createDiv('view-header-title')
    this.actionsEl = this.headerEl.createDiv('view-actions')
    this.contentEl = this.containerEl.createDiv('view-content')
  }
  addAction(icon: string, title: string, callback: (evt: MouseEvent) => any) {
    const el = this.actionsEl.createEl('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': title, title } })
    setIcon(el, icon)
    el.addEventListener('click', callback)
    return el
  }
}

export abstract class FileView extends ItemView {
  file: TFile | null = null
  allowNoFile = false
  override navigation = true

  getDisplayText() { return this.file?.basename ?? 'Немає файлу' }
  getState(): Record<string, unknown> { return { file: this.file?.path ?? null } }
  async setState(state: Record<string, unknown>) {
    const file = typeof state.file === 'string' ? this.app.vault.getFileByPath(state.file) : null
    if (!file || file === this.file) return
    if (this.file) await this.onUnloadFile(this.file)
    this.file = file
    await this.onLoadFile(file)
    this.leaf.updateHeader()
  }
  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}
}

class EmptyView extends ItemView {
  getViewType() { return 'empty' }
  getDisplayText() { return 'Нова вкладка' }
  async onOpen() {
    const box = this.contentEl.createDiv('empty-state')
    box.createDiv({ cls: 'empty-state-title', text: 'Нотатку не відкрито' })
    box.createDiv({ cls: 'empty-state-hint', text: 'Оберіть нотатку зліва або створіть нову.' })
    const create = box.createEl('button', { cls: 'aether-button mod-cta empty-state-action' })
    create.createSpan({ text: 'Створити нотатку' })
    create.createEl('kbd', { text: hotkeyLabel({ modifiers: ['Mod'], key: 'N' }), attr: { 'aria-hidden': 'true' } })
    create.addEventListener('click', () => void this.app.newNote())
    const recent = this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 5)
    if (!recent.length) return
    box.createDiv({ cls: 'empty-state-subtitle', text: 'Нещодавні' })
    const list = box.createDiv({ cls: 'empty-state-recent' })
    for (const file of recent) {
      const b = list.createEl('button', { cls: 'empty-state-recent-item', text: file.basename, attr: { title: file.path } })
      b.addEventListener('click', () => void this.leaf.openFile(file))
    }
  }
}

export type Side = 'left' | 'right' | 'root'

export class WorkspaceLeaf extends Events {
  app: App
  view!: View
  readonly side: Side
  containerEl: HTMLElement
  /** root leaves only */
  tabHeaderEl?: HTMLElement

  constructor(app: App, side: Side) {
    super()
    this.app = app
    this.side = side
    this.containerEl = createDiv('workspace-leaf')
  }

  async setViewState(vs: ViewState) {
    const creator = this.app.viewRegistry.get(vs.type)
    if (!this.view || this.view.getViewType() !== vs.type) {
      if (this.view) await this.closeView()
      const view = creator ? creator(this) : new EmptyView(this)
      view.containerEl.setAttr('data-type', view.getViewType())
      this.containerEl.appendChild(view.containerEl)
      this.view = view
      view.load()
      await view.onOpen()
    }
    if (vs.state) await this.view.setState(vs.state)
    this.updateHeader()
    if (vs.active) this.app.workspace.setActiveLeaf(this, { focus: true })
    this.app.workspace.requestLayoutChange()
  }

  getViewState(): ViewState {
    return { type: this.view?.getViewType() ?? 'empty', state: this.view?.getState() ?? {} }
  }

  async openFile(file: TFile, openState?: { active?: boolean }) {
    const type = this.app.extensionViews.get(file.extension.toLowerCase()) ?? 'markdown'
    await this.setViewState({ type, state: { file: file.path }, active: openState?.active ?? true })
    if (this.app.workspace.activeLeaf === this) this.app.workspace.trigger('file-open', file)
  }

  getDisplayText() {
    return this.view?.getDisplayText() ?? ''
  }

  /** The window this leaf lives in; there are no pop-out windows yet. */
  getContainer() {
    return { win: window, doc: document, containerEl: this.app.workspace.containerEl }
  }
  getRoot() {
    return this.getContainer()
  }

  updateHeader() {
    if (this.tabHeaderEl) {
      const title = this.tabHeaderEl.querySelector('.workspace-tab-header-inner-title')!
      title.setText(this.getDisplayText())
      // a lone empty tab is not a tab to the user: the empty state is the start screen (hidden in shell.css)
      this.tabHeaderEl.toggleClass('is-empty-tab', this.view?.getViewType() === 'empty')
    }
    if (this.view instanceof ItemView) this.view.titleEl.setText(this.getDisplayText())
  }

  private async closeView() {
    const view = this.view
    await view.onClose()
    view.unload()
    view.containerEl.remove()
  }

  async detach() {
    if (this.view) await this.closeView()
    this.app.workspace.removeLeaf(this)
  }
}

export class Workspace extends Events {
  app: App
  containerEl!: HTMLElement
  leftSplitEl!: HTMLElement
  rightSplitEl!: HTMLElement
  rootEl!: HTMLElement
  tabHeadersEl!: HTMLElement
  tabsEl!: HTMLElement
  dockPluginsEl!: HTMLElement
  activeLeaf: WorkspaceLeaf | null = null
  layoutReady = false
  readonly leaves: WorkspaceLeaf[] = []
  readonly editorExtensions: Extension[] = []
  readonly editorSuggests: EditorSuggest<unknown>[] = []
  readonly hoverLinkSources = new Map<string, { display: string; defaultMod: boolean }>()
  private activeSuggest: EditorSuggest<unknown> | null = null
  private readyCallbacks: (() => any)[] = []

  constructor(app: App) {
    super()
    this.app = app
  }

  on(name: 'file-open', callback: (file: TFile | null) => any, ctx?: any): EventRef
  on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => any, ctx?: any): EventRef
  on(name: 'layout-change' | 'resize' | 'css-change' | 'quit', callback: () => any, ctx?: any): EventRef
  on(name: 'editor-change', callback: (editor: unknown, info: MarkdownView) => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef
  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    return super.on(name, callback, ctx)
  }

  onLayoutReady(cb: () => any) {
    if (this.layoutReady) cb()
    else this.readyCallbacks.push(cb)
  }
  /** @internal */
  setLayoutReady() {
    this.layoutReady = true
    for (const cb of this.readyCallbacks.splice(0)) {
      try { cb() } catch (e) { console.error(e) }
    }
  }

  private layoutTimer: ReturnType<typeof setTimeout> | undefined
  requestLayoutChange() {
    clearTimeout(this.layoutTimer)
    this.layoutTimer = setTimeout(() => this.trigger('layout-change'), 0)
  }

  private createLeaf(side: Side) {
    const leaf = new WorkspaceLeaf(this.app, side)
    this.leaves.push(leaf)
    if (side === 'root') {
      const header = this.tabHeadersEl.createDiv({ cls: 'workspace-tab-header', attr: { role: 'presentation' } })
      const tab = header.createEl('button', { cls: 'workspace-tab-header-inner', attr: { role: 'tab' } })
      tab.createSpan('workspace-tab-header-inner-title')
      tab.addEventListener('click', () => this.setActiveLeaf(leaf, { focus: true }))
      const close = header.createEl('button', { cls: 'workspace-tab-header-inner-close-button clickable-icon', attr: { 'aria-label': 'Закрити вкладку' } })
      setIcon(close, 'x')
      close.addEventListener('click', () => leaf.detach())
      leaf.tabHeaderEl = header
      this.tabsEl.appendChild(leaf.containerEl)
    } else {
      ;(side === 'left' ? this.leftSplitEl : this.rightSplitEl).appendChild(leaf.containerEl)
      this.updateRightSplit()
    }
    return leaf
  }

  private rootLeaves() {
    return this.leaves.filter((l) => l.side === 'root')
  }

  /** `false`: reuse the active tab; `true` / 'tab' / 'split' / 'window': a new tab. */
  getLeaf(newLeaf?: boolean | 'tab' | 'split' | 'window'): WorkspaceLeaf {
    const active = this.activeLeaf?.side === 'root' ? this.activeLeaf : this.rootLeaves().at(-1)
    if (!newLeaf && active) return active
    const leaf = this.createLeaf('root')
    leaf.setViewState({ type: 'empty' })
    return leaf
  }
  getLeftLeaf(_split = false) { return this.createLeaf('left') }
  getRightLeaf(_split = false) { return this.createLeaf('right') }

  getLeavesOfType(type: string) {
    return this.leaves.filter((l) => l.view?.getViewType() === type)
  }
  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => any) {
    this.leaves.forEach(cb)
  }
  iterateRootLeaves(cb: (leaf: WorkspaceLeaf) => any) {
    this.rootLeaves().forEach(cb)
  }
  detachLeavesOfType(type: string) {
    for (const l of this.getLeavesOfType(type)) l.detach()
  }
  revealLeaf(leaf: WorkspaceLeaf) {
    if (leaf.side === 'root') this.setActiveLeaf(leaf)
    else leaf.containerEl.scrollIntoView({ block: 'nearest' })
  }

  getActiveViewOfType<T extends View>(type: abstract new (...args: any[]) => T): T | null {
    const view = this.activeLeaf?.view
    return view instanceof type ? view : null
  }
  /** @internal */
  getActiveMarkdownView(): MarkdownView | null {
    const view = this.activeLeaf?.view as MarkdownView | undefined
    return view?.getViewType() === 'markdown' ? view : null
  }
  getActiveFile(): TFile | null {
    return this.getActiveMarkdownView()?.file ?? null
  }

  setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean }) {
    if (leaf.side === 'root') {
      for (const l of this.rootLeaves()) {
        const on = l === leaf
        l.containerEl.toggleClass('mod-active', on)
        l.containerEl.toggle(on)
        l.tabHeaderEl?.toggleClass('is-active', on)
        l.tabHeaderEl?.querySelector('[role=tab]')?.setAttr('aria-selected', on)
      }
    }
    if (this.activeLeaf === leaf) return
    this.activeLeaf = leaf
    this.trigger('active-leaf-change', leaf)
    const file = this.getActiveFile()
    if (file) this.trigger('file-open', file)
    if (params?.focus) (leaf.view as Partial<MarkdownView>)?.editor?.focus()
  }

  async openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean | 'tab') {
    const path = linktext.split('#')[0]
    let file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath)
    // Obsidian creates the note when a link points nowhere
    file ??= await this.app.createNote(path.endsWith('.md') ? path.slice(0, -3) : path)
    await this.getLeaf(newLeaf).openFile(file)
  }

  /** @internal */
  removeLeaf(leaf: WorkspaceLeaf) {
    const i = this.leaves.indexOf(leaf)
    if (i < 0) return
    this.leaves.splice(i, 1)
    leaf.containerEl.remove()
    leaf.tabHeaderEl?.remove()
    this.updateRightSplit()
    if (this.activeLeaf === leaf) {
      this.activeLeaf = null
      const next = this.rootLeaves().at(-1) ?? (leaf.side === 'root' ? this.getLeaf(true) : null)
      if (next) this.setActiveLeaf(next)
    }
    this.requestLayoutChange()
  }

  private updateRightSplit() {
    this.rightSplitEl?.toggleClass('is-collapsed', !this.leaves.some((l) => l.side === 'right'))
  }

  /** shortcut: sources are only recorded; there is no hover preview yet. */
  registerHoverLinkSource(id: string, info: { display: string; defaultMod: boolean }) {
    this.hoverLinkSources.set(id, info)
  }
  unregisterHoverLinkSource(id: string) {
    this.hoverLinkSources.delete(id)
  }

  /** @internal After typing: the first editor suggest that triggers at the cursor opens, the others close. */
  async updateEditorSuggest(view: MarkdownView) {
    for (const s of this.editorSuggests) {
      try {
        if (await s.update(view.editor, view.file)) {
          for (const other of this.editorSuggests) if (other !== s) other.close()
          this.activeSuggest = s
          return
        }
      } catch (e) {
        console.error(e)
        s.close()
      }
    }
    this.activeSuggest = null
  }
  /** @internal Keys while a suggest list is open; false lets the editor handle the key. */
  editorSuggestKey(key: 'up' | 'down' | 'enter' | 'escape', evt?: KeyboardEvent): boolean {
    const s = this.activeSuggest
    if (!s?.isOpen) return false
    if (key === 'escape') s.close()
    else if (key === 'enter') s.choose(evt ?? new KeyboardEvent('keydown', { key: 'Enter' }))
    else s.moveSelection(key === 'up' ? -1 : 1)
    return true
  }
  /** @internal A key the open list's own scope handles (before the built-in arrows / Enter). */
  editorSuggestScopeKey(evt: KeyboardEvent): boolean {
    const s = this.activeSuggest
    return !!s?.isOpen && s.scope.handle(evt)
  }
  closeEditorSuggest() {
    this.activeSuggest?.close()
    this.activeSuggest = null
  }

  addEditorExtension(ext: Extension) {
    this.editorExtensions.push(ext)
    this.updateOptions()
  }
  removeEditorExtension(ext: Extension) {
    const i = this.editorExtensions.indexOf(ext)
    if (i >= 0) this.editorExtensions.splice(i, 1)
    this.updateOptions()
  }
  /** Re-applies plugin editor extensions to every open editor. */
  updateOptions() {
    for (const l of this.getLeavesOfType('markdown')) (l.view as MarkdownView).reconfigure()
  }
}
