/**
 * `App`: one open vault and everything around it (`app.vault`, `app.metadataCache`, `app.workspace`, …),
 * plus the window shell from the «Glass» mockup built around Obsidian's workspace DOM.
 */
import { MetadataCache } from '../core/metadata/metadataCache.js'
import { FileSystemAdapter } from '../core/vault/adapter.js'
import type { TFile, TFolder } from '../core/vault/files.js'
import { FileManager } from '../core/vault/fileManager.js'
import { TagStore } from './tagStore.js'
import { openVaultSwitch } from './vaultSwitch.js'
import { Vault } from '../core/vault/vault.js'
import { CommandPalette, Commands, hotkeyLabel } from './commands.js'
import { MarkdownView } from './editor/markdownView.js'
import { linkAt } from './editor/livePreview.js'
import type { CodeBlockProcessor, MarkdownPostProcessor } from './editor/render.js'
import { setIcon } from './icons.js'
import { hostModules } from './plugins/obsidian.js'
import { PluginManager } from './plugins/pluginManager.js'
import { isVaultTrusted, SettingsModal, TrustModal, trustVault } from './plugins/settings.js'
import { FileExplorerView, TagView } from './views/fileExplorer.js'
import { BacklinksView } from './views/backlinks.js'
import { GraphView } from './views/graph.js'
import { GALAXY_VIEW, GalaxyView } from './galaxy/galaxyView.js'
import { coreSettingTabs, insertTemplate, loadCorePlugins, openDailyNote, type CorePlugin } from './corePlugins.js'
import { AddNoteModal, CanvasView } from './canvas/canvasView.js'
import { inkColor, recentInk, useInk } from './canvas/ink.js'
import { installUpdateNotice } from './updates.js'
import { serializeCanvas } from '../core/canvas/canvasData.js'
import { fileMenu, renameWithPrompt, trashWithUndo } from './views/fileActions.js'
import { type View, Workspace, type WorkspaceLeaf } from './workspace.js'

export type SaveState = 'saved' | 'pending' | 'error'

export class App {
  readonly vault: Vault
  readonly metadataCache: MetadataCache
  readonly workspace: Workspace
  readonly commands: Commands
  readonly plugins: PluginManager
  readonly setting: SettingsModal
  readonly fileManager: FileManager
  /** tags made by hand: per vault, or everywhere */
  readonly tags: TagStore
  readonly viewRegistry = new Map<string, (leaf: WorkspaceLeaf) => View>()
  /** file extension → view type that opens it */
  readonly extensionViews = new Map<string, string>([['md', 'markdown']])
  readonly markdownPostProcessors = new Set<MarkdownPostProcessor>()
  readonly codeBlockProcessors = new Map<string, CodeBlockProcessor>()
  /** Obsidian's core plugins (daily notes, templates, …). shortcut: none exist yet, so plugins fall back to their defaults. */
  readonly internalPlugins = {
    plugins: {} as Record<string, CorePlugin<unknown>>,
    getPluginById: (id: string): CorePlugin<unknown> | null => this.internalPlugins.plugins[id] ?? null,
    getEnabledPluginById: (id: string) => (this.internalPlugins.plugins[id]?.enabled ? this.internalPlugins.plugins[id].instance : null),
  }
  /** Handlers for `obsidian://<action>` links. shortcut: recorded only, the app does not receive such links yet. */
  readonly protocolHandlers = new Map<string, (params: Record<string, string>) => any>()
  statusBarEl!: HTMLElement
  private saveEl!: HTMLElement
  private searchEl!: HTMLInputElement
  private explorer: FileExplorerView | undefined
  /** Called to open another vault; the boot code reloads the page with it. */
  onOpenVault: () => void = () => {}

  constructor(basePath: string) {
    this.vault = new Vault(new FileSystemAdapter(basePath))
    this.metadataCache = new MetadataCache(this.vault)
    this.workspace = new Workspace(this)
    this.commands = new Commands(this)
    this.plugins = new PluginManager(this, () => hostModules)
    this.setting = new SettingsModal(this)
    this.fileManager = new FileManager(this.vault, this.metadataCache)
    this.tags = new TagStore(this)
    this.fileManager.beforeRewrite = () => this.flush()
  }

  async start(root: HTMLElement) {
    this.buildShell(root)
    installUpdateNotice(this)
    this.viewRegistry.set('markdown', (leaf) => new MarkdownView(leaf))
    this.viewRegistry.set('file-explorer', (leaf) => new FileExplorerView(leaf))
    this.viewRegistry.set('tag', (leaf) => new TagView(leaf))
    this.viewRegistry.set('canvas', (leaf) => new CanvasView(leaf))
    this.viewRegistry.set('backlink', (leaf) => new BacklinksView(leaf))
    this.viewRegistry.set('graph', (leaf) => new GraphView(leaf))
    this.viewRegistry.set(GALAXY_VIEW, (leaf) => new GalaxyView(leaf))
    this.extensionViews.set('canvas', 'canvas')
    this.addCoreCommands()
    document.addEventListener('keydown', (e) => this.commands.handleKey(e), true)
    window.addEventListener('resize', () => this.workspace.trigger('resize'))

    await this.tags.load()
    // the panels go up first and fill while the vault is read, so a big vault shows its tree early
    await this.workspace.getLeftLeaf().setViewState({ type: 'file-explorer' })
    this.explorer = this.workspace.getLeavesOfType('file-explorer')[0].view as FileExplorerView
    await this.workspace.getLeftLeaf().setViewState({ type: 'tag' })
    await this.vault.load()
    await this.metadataCache.idle()
    await this.restoreTabs()
    this.workspace.setLayoutReady()
    this.vault.startWatching()
    this.workspace.on('layout-change', () => this.saveTabsSoon())
    this.workspace.on('canvas:selection', () => this.saveTabsSoon())

    await loadCorePlugins(this)
    for (const tab of coreSettingTabs(this)) this.setting.coreTabs.push(tab)
    await this.plugins.loadManifests()
    const listed = await this.plugins.readEnabledList()
    const base = this.vault.adapter.getBasePath()
    if (listed.length && isVaultTrusted(base)) await this.plugins.loadEnabled()
    else if (listed.some((id) => this.plugins.manifests[id])) {
      new TrustModal(this, () => { trustVault(base); void this.plugins.loadEnabled() }).open()
    }
  }

  // ---- shell -------------------------------------------------------------

  private buildShell(root: HTMLElement) {
    const app = root.createDiv('app-container')
    const ws = app.createDiv('horizontal-main-container').createDiv('workspace')
    this.workspace.containerEl = ws

    // left sidebar: search, files, tags, then path and save status
    const left = ws.createEl('aside', { cls: 'workspace-split mod-horizontal mod-sidedock mod-left-split', attr: { 'aria-label': 'Бічна панель' } })
    const search = left.createDiv('aether-search')
    setIcon(search.createSpan('aether-search-icon'), 'search')
    this.searchEl = search.createEl('input', { type: 'search', placeholder: 'Пошук', attr: { 'aria-label': 'Пошук нотаток за назвою або #тегом' } })
    search.createEl('kbd', { text: hotkeyLabel({ modifiers: ['Mod'], key: 'K' }), attr: { 'aria-hidden': 'true' } })
    this.searchEl.addEventListener('input', () => this.explorer?.setFilter(this.searchEl.value))
    this.workspace.leftSplitEl = left.createDiv('workspace-sidedock-leaves')
    // empty sidebar space: the vault root's menu (new note, folder, canvas, tag, workspace)
    this.workspace.leftSplitEl.addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest('input, textarea, button')) return
      fileMenu(this, this.vault.getRoot()).showAtMouseEvent(e)
    })

    const bottom = left.createDiv('aether-sidebar-footer')
    this.statusBarEl = bottom.createDiv('status-bar')
    // the vault name is a button: a press asks whether to switch to another folder
    const vaultBtn = this.statusBarEl.createEl('button', {
      cls: 'status-bar-item mod-path', text: this.vault.getName(),
      attr: { type: 'button', title: `${this.vault.adapter.getBasePath()} — змінити папку`, 'aria-label': `Сховище «${this.vault.getName()}». Змінити папку`, 'aria-haspopup': 'dialog', 'aria-expanded': false },
    })
    vaultBtn.addEventListener('click', () => openVaultSwitch(this, vaultBtn))
    this.saveEl = this.statusBarEl.createDiv({ cls: 'status-bar-item mod-save', attr: { role: 'status' } })
    this.setSaveState('saved')
    const gear = bottom.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Налаштування' } })
    setIcon(gear, 'settings')
    gear.addEventListener('click', () => this.setting.open())

    // root: header, tabs, canvas placeholder, floating dock
    const main = ws.createEl('main', { cls: 'workspace-split mod-vertical mod-root' })
    const header = main.createEl('header', 'aether-header')
    header.createEl('h1', { cls: 'aether-vault-name', text: this.vault.getName() })
    const modes = header.createDiv({ cls: 'aether-segmented', attr: { role: 'group', 'aria-label': 'Вигляд' } })
    const canvasBtn = modes.createEl('button', { text: 'Полотно', attr: { 'aria-pressed': 'false' } })
    const notesBtn = modes.createEl('button', { text: 'Нотатки', attr: { 'aria-pressed': 'true' } })
    const galaxyBtn = modes.createEl('button', { text: 'Галактика', attr: { 'aria-pressed': 'false' } })
    header.createDiv('aether-spacer')
    const linksBtn = header.createEl('button', { cls: 'clickable-icon aether-header-icon', attr: { 'aria-label': 'Зворотні посилання', title: 'Зворотні посилання', 'aria-pressed': false } })
    setIcon(linksBtn, 'link') // a chain reads as «links»; the old arrow (links-coming-in) said nothing
    linksBtn.addEventListener('click', () => void this.toggleBacklinks().then((on) => linksBtn.setAttr('aria-pressed', on)))

    const tabs = main.createDiv('workspace-tabs mod-top mod-active')
    const tabBar = tabs.createDiv('workspace-tab-header-container')
    this.workspace.tabHeadersEl = tabBar.createDiv({ cls: 'workspace-tab-header-container-inner', attr: { role: 'tablist', 'aria-label': 'Відкриті нотатки' } })
    this.workspace.tabsEl = tabs.createDiv('workspace-tab-container')
    this.workspace.rootEl = main

    // the switch shows which kind of view is in front: the vault's canvas or notes
    // one thumb slides between the two options (a bouncy spring), like an iOS segmented control
    const thumb = modes.createSpan({ cls: 'aether-segmented-thumb', attr: { 'aria-hidden': 'true' } })
    modes.addClass('has-thumb')
    const moveThumb = (to: HTMLElement) => {
      thumb.style.width = `${to.offsetWidth}px`
      thumb.style.transform = `translateX(${to.offsetLeft}px)`
    }
    const syncMode = () => {
      const type = this.workspace.activeLeaf?.view?.getViewType()
      const isCanvas = type === 'canvas'
      const isGalaxy = type === GALAXY_VIEW
      canvasBtn.setAttr('aria-pressed', isCanvas)
      notesBtn.setAttr('aria-pressed', !isCanvas && !isGalaxy)
      galaxyBtn.setAttr('aria-pressed', isGalaxy)
      moveThumb(isCanvas ? canvasBtn : isGalaxy ? galaxyBtn : notesBtn)
      dock.hidden = isGalaxy // the Galaxy has a dock of its own
      // canvas-only tools are hidden, not disabled, when the canvas is not in front
      for (const el of canvasOnly) el.hidden = !isCanvas
      const addLabel = isCanvas ? 'Картка' : 'Нотатка'
      addBtn.setAttr('aria-label', addLabel)
      addBtn.title = addLabel
      addBtn.querySelector('.aether-dock-label')?.setText(addLabel)
      drawBtn.setAttr('aria-pressed', !!this.activeCanvas()?.drawing)
      ink.toggleClass('is-open', isCanvas && !!this.activeCanvas()?.drawing)
      zoomLabel.setText(isCanvas ? `${Math.round(this.activeCanvas()!.zoom * 100)}%` : '100%')
    }
    canvasBtn.addEventListener('click', () => void this.openMainCanvas())
    notesBtn.addEventListener('click', () => void this.showNotes())
    galaxyBtn.addEventListener('click', () => void this.openGalaxy())

    const dock = main.createEl('nav', { cls: 'aether-dock', attr: { 'aria-label': 'Інструменти' } })
    const tool = (parent: HTMLElement, icon: string, label: string, onClick?: () => void, text = true) => {
      const b = parent.createEl('button', { cls: 'aether-dock-button', attr: { 'aria-label': label, title: onClick ? label : `${label} — з'явиться пізніше`, disabled: !onClick } })
      if (icon) setIcon(b.createSpan(), icon)
      if (text) b.createSpan({ cls: 'aether-dock-label', text: label })
      if (onClick) b.addEventListener('click', onClick)
      return b
    }
    const addBtn = tool(dock, 'file-plus', 'Нотатка', () => { const c = this.activeCanvas(); if (c) c.addTextCard(); else void this.newNote() })
    const drawBtn = tool(dock, 'pencil', 'Малювати', () => { const c = this.activeCanvas(); c?.setDrawMode(!c.drawing) })
    drawBtn.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.activeCanvas()?.setDrawMode(false) })
    // while drawing, the dock opens a colour strip right after «Малювати»: the 4 last colours and a picker
    const ink = dock.createDiv({ cls: 'aether-ink', attr: { role: 'group', 'aria-label': 'Колір малювання' } })
    const renderInk = () => {
      ink.empty()
      const now = inkColor()
      for (const c of recentInk()) {
        const b = ink.createEl('button', { cls: 'aether-ink-swatch', attr: { type: 'button', 'aria-label': `Колір ${c}`, title: c, 'aria-pressed': c === now } })
        b.style.setProperty('--ink', c)
        b.addEventListener('click', () => { useInk(c); renderInk() })
      }
      const pick = ink.createEl('label', { cls: 'aether-ink-swatch aether-ink-pick', attr: { title: 'Інший колір' } })
      const input = pick.createEl('input', { attr: { type: 'color', 'aria-label': 'Вибрати інший колір' } })
      input.value = now
      input.addEventListener('change', () => { useInk(input.value); renderInk(); ink.querySelector<HTMLElement>('.aether-ink-pick input')?.focus() })
    }
    renderInk()
    tool(dock, 'git-fork', 'Граф', () => void this.openGraph())
    const canvasOnly: HTMLElement[] = [drawBtn, tool(dock, 'frame', 'Рамка', () => this.activeCanvas()?.addGroup())]
    canvasOnly.push(dock.createDiv({ cls: 'aether-dock-separator', attr: { 'aria-hidden': 'true' } }))
    const zoom = dock.createDiv({ cls: 'aether-zoom', attr: { role: 'group', 'aria-label': 'Масштаб полотна' } })
    canvasOnly.push(zoom)
    tool(zoom, 'minus', 'Зменшити', () => this.activeCanvas()?.zoomBy(1 / 1.25), false)
    const zoomLabel = tool(zoom, '', '100%', () => this.activeCanvas()?.zoomReset(), false)
    zoomLabel.setAttr('aria-label', 'Масштаб 100%')
    zoomLabel.setText('100%')
    tool(zoom, 'plus', 'Збільшити', () => this.activeCanvas()?.zoomBy(1.25), false)
    this.workspace.on('active-leaf-change', syncMode)
    this.workspace.on('layout-change', syncMode)
    this.workspace.on('canvas:zoom', (view: CanvasView) => { if (view === this.activeCanvas()) syncMode() })
    this.workspace.on('canvas:draw', (view: CanvasView) => { if (view === this.activeCanvas()) syncMode() })
    syncMode()
    void document.fonts?.ready.then(syncMode) // Inter may load after the first layout: re-measure the thumb
    this.workspace.dockPluginsEl = dock.createDiv({ cls: 'aether-dock-plugins', attr: { role: 'group', 'aria-label': 'Плагіни' } })

    this.workspace.rightSplitEl = ws.createEl('aside', { cls: 'workspace-split mod-horizontal mod-sidedock mod-right-split is-collapsed', attr: { 'aria-label': 'Права панель' } })
  }

  setSaveState(state: SaveState) {
    if (!this.saveEl) return
    this.saveEl.setText({ saved: 'Збережено', pending: 'Збереження…', error: 'Не збережено' }[state])
    this.saveEl.dataset.state = state
  }
  /** Views that keep a file open and save it themselves (notes, canvases). */
  private savingViews() {
    return this.workspace.leaves.map((l) => l.view as Partial<{ save(): Promise<void>; isDirty(): boolean }>).filter((v) => typeof v?.save === 'function')
  }
  hasUnsaved() {
    return this.savingViews().some((v) => v.isDirty?.())
  }
  /** Writes every open note. Called before the window closes or another vault opens. */
  async flush() {
    if (this.workspace.layoutReady) await this.saveTabs()
    await Promise.all(this.savingViews().map((v) => v.save!()))
  }

  // ---- open tabs between runs (`<configDir>/workspace.json`, like Obsidian) ----

  private get layoutPath() { return `${this.vault.configDir}/workspace.json` }
  private tabsTimer: ReturnType<typeof setTimeout> | undefined
  private lastLayout = ''

  private saveTabsSoon() {
    clearTimeout(this.tabsTimer)
    this.tabsTimer = setTimeout(() => void this.saveTabs(), 500)
  }

  /** @internal */
  async saveTabs() {
    clearTimeout(this.tabsTimer)
    const tabs: { file: string | null; mode: string }[] = []
    this.workspace.iterateRootLeaves((leaf) => {
      const view = leaf.view as Partial<MarkdownView>
      tabs.push({ file: view.file?.path ?? null, mode: view.getMode?.() ?? 'source' })
    })
    const active = this.workspace.leaves.filter((l) => l.side === 'root').indexOf(this.workspace.activeLeaf!)
    // the cards selected on the open canvas: Claude's read-only server shows them as «what is selected now»
    const canvas = this.activeCanvas()
    const cards = canvas?.file ? canvas.selectedIds() : []
    const layout = JSON.stringify({ tabs, active, ...(cards.length ? { selection: { canvas: canvas!.file!.path, cards } } : {}) }, null, 2)
    if (layout === this.lastLayout) return
    try {
      await this.vault.adapter.mkdir(this.vault.configDir)
      await this.vault.adapter.write(this.layoutPath, layout)
      this.lastLayout = layout
    } catch (e) {
      console.error('Cannot save open tabs', e)
    }
  }

  /** Opens the tabs from the last run; a missing or broken file just means one empty tab. */
  private async restoreTabs() {
    let saved: { tabs?: { file?: string | null; mode?: string }[]; active?: number } = {}
    try { saved = JSON.parse(await this.vault.adapter.read(this.layoutPath)) } catch { /* first run */ }
    const leaves = []
    for (const tab of Array.isArray(saved.tabs) ? saved.tabs : []) {
      const file = typeof tab?.file === 'string' ? this.vault.getFileByPath(tab.file) : null
      if (!file) continue
      const leaf = this.workspace.getLeaf(true)
      await leaf.openFile(file, { active: false })
      if (tab.mode === 'preview') await (leaf.view as MarkdownView).setMode('preview')
      leaves.push(leaf)
    }
    // nothing saved yet but the vault has its board (a vault moved from the old Aether): show the board
    if (!leaves.length && this.vault.getFileByPath('Полотно.canvas')) return this.openMainCanvas()
    this.workspace.setActiveLeaf(leaves[saved.active ?? -1] ?? leaves.at(-1) ?? this.workspace.getLeaf(true))
  }

  searchFor(query: string) {
    this.searchEl.value = query
    this.explorer?.setFilter(query)
    this.searchEl.focus()
  }

  // ---- notes -------------------------------------------------------------

  /** Creates `<name>.md` (or `<name> 1.md`, … if taken); `name` may include folders. */
  async createNote(name: string, text = ''): Promise<TFile> {
    for (let i = 0; ; i++) {
      const path = `${name}${i ? ` ${i}` : ''}.md`
      if (!this.vault.getAbstractFileByPath(path)) return this.vault.create(path, text)
    }
  }

  /** The graph in its own tab (the one already open, if any). */
  async openGalaxy() {
    const open = this.workspace.getLeavesOfType(GALAXY_VIEW)[0]
    if (open) this.workspace.setActiveLeaf(open, { focus: true })
    else await this.leafForNewFile().setViewState({ type: GALAXY_VIEW, active: true })
  }

  async openGraph() {
    const open = this.workspace.getLeavesOfType('graph')[0]
    if (open) this.workspace.setActiveLeaf(open, { focus: true })
    else await this.leafForNewFile().setViewState({ type: 'graph', active: true })
  }

  /** Shows or hides the backlinks panel on the right; returns whether it is shown now. */
  async toggleBacklinks() {
    const open = this.workspace.getLeavesOfType('backlink')
    if (open.length) {
      for (const l of open) await l.detach()
      return false
    }
    await this.workspace.getRightLeaf().setViewState({ type: 'backlink' })
    return true
  }

  activeCanvas(): CanvasView | null {
    const view = this.workspace.activeLeaf?.view
    return view instanceof CanvasView ? view : null
  }

  /** A new tab, unless the active tab is empty: then that one. */
  private leafForNewFile() {
    return this.workspace.getLeaf(this.workspace.activeLeaf?.view?.getViewType() !== 'empty')
  }

  /** «Полотно»: the vault's main canvas, `Полотно.canvas` in the root (made on first use). */
  async openMainCanvas() {
    const path = 'Полотно.canvas'
    const file = this.vault.getFileByPath(path) ?? (await this.vault.create(path, serializeCanvas({ nodes: [], edges: [] })))
    const open = this.workspace.leaves.find((l) => l.side === 'root' && (l.view as Partial<CanvasView>).file === file)
    if (open) this.workspace.setActiveLeaf(open, { focus: true })
    else await this.leafForNewFile().openFile(file)
  }

  /** «Нотатки»: back to the last note tab, or a new empty one. */
  async showNotes() {
    // «Нотатки» = a note tab or an empty one; the canvas, the Galaxy and the graph have their own buttons
    const leaf = [...this.workspace.leaves].reverse().find((l) => l.side === 'root' && ['markdown', 'empty'].includes(l.view?.getViewType() ?? 'empty'))
    this.workspace.setActiveLeaf(leaf ?? this.workspace.getLeaf(true), { focus: true })
  }

  async newCanvas(folder?: TFolder) {
    for (let i = 0; ; i++) {
      const path = `${folder && !folder.isRoot() ? `${folder.path}/` : ''}Полотно${i ? ` ${i}` : ''}.canvas`
      if (!this.vault.getAbstractFileByPath(path)) {
        const file = await this.vault.create(path, serializeCanvas({ nodes: [], edges: [] }))
        return this.leafForNewFile().openFile(file)
      }
    }
  }

  async newNote(folder?: TFolder) {
    const file = await this.createNote(folder && !folder.isRoot() ? `${folder.path}/Без назви` : 'Без назви')
    await this.workspace.getLeaf(false).openFile(file)
  }

  private addCoreCommands() {
    const c = this.commands
    c.addCommand({ id: 'file:new', name: 'Створити нотатку', hotkeys: [{ modifiers: ['Mod'], key: 'n' }], callback: () => void this.newNote() })
    c.addCommand({ id: 'command-palette:open', name: 'Відкрити палітру команд', hotkeys: [{ modifiers: ['Mod'], key: 'p' }], callback: () => new CommandPalette(this).open() })
    c.addCommand({ id: 'app:open-settings', name: 'Відкрити налаштування', hotkeys: [{ modifiers: ['Mod'], key: ',' }], callback: () => this.setting.open() })
    c.addCommand({ id: 'app:search', name: 'Шукати нотатки', hotkeys: [{ modifiers: ['Mod'], key: 'k' }, { modifiers: ['Mod'], key: ' ' }], callback: () => this.searchFor(this.searchEl.value) })
    c.addCommand({ id: 'app:open-vault', name: 'Відкрити інше сховище…', callback: () => this.onOpenVault() })
    c.addCommand({
      id: 'workspace:close', name: 'Закрити вкладку', hotkeys: [{ modifiers: ['Mod'], key: 'w' }],
      checkCallback: (checking) => {
        const leaf = this.workspace.activeLeaf
        if (leaf?.side !== 'root') return false
        if (!checking) void leaf.detach()
        return true
      },
    })
    c.addCommand({ id: 'daily-notes', name: 'Відкрити нотатку на сьогодні', callback: () => void openDailyNote(this) })
    c.addCommand({ id: 'insert-template', name: 'Вставити шаблон…', editorCallback: (editor, view) => insertTemplate(this, editor, view.file?.basename ?? '') })
    c.addCommand({ id: 'galaxy:open', name: 'Відкрити галактику', callback: () => void this.openGalaxy() })
    c.addCommand({ id: 'graph:open', name: 'Відкрити граф', hotkeys: [{ modifiers: ['Mod'], key: 'g' }], callback: () => void this.openGraph() })
    c.addCommand({ id: 'backlink:toggle', name: 'Показати / сховати зворотні посилання', callback: () => void this.toggleBacklinks() })
    c.addCommand({ id: 'canvas:new-file', name: 'Створити полотно', callback: () => void this.newCanvas() })
    c.addCommand({ id: 'canvas:open-main', name: 'Відкрити головне полотно', callback: () => void this.openMainCanvas() })
    c.addCommand({
      id: 'canvas:add-note', name: 'Додати нотатку на полотно…', checkCallback: (checking) => {
        const canvas = this.activeCanvas()
        if (!canvas) return false
        if (!checking) new AddNoteModal(canvas).open()
        return true
      },
    })
    c.addCommand({
      id: 'canvas:add-text', name: 'Додати картку', checkCallback: (checking) => {
        const canvas = this.activeCanvas()
        if (!canvas) return false
        if (!checking) canvas.addTextCard()
        return true
      },
    })
    const onCanvas = (id: string, name: string, run: (canvas: CanvasView) => void) => c.addCommand({
      id, name, checkCallback: (checking) => {
        const canvas = this.activeCanvas()
        if (!canvas) return false
        if (!checking) run(canvas)
        return true
      },
    })
    onCanvas('canvas:undo', 'Скасувати дію на полотні', (canvas) => canvas.undo())
    onCanvas('canvas:redo', 'Повторити дію на полотні', (canvas) => canvas.redo())
    onCanvas('canvas:clear-drawings', 'Очистити малюнки', (canvas) => void canvas.clearStrokes())
    onCanvas('canvas:remove-duplicate-edges', 'Прибрати повторні зв’язки', (canvas) => void canvas.removeDuplicateEdges())
    c.addCommand({
      id: 'file:rename', name: 'Перейменувати поточну нотатку', hotkeys: [{ modifiers: [], key: 'F2' }],
      checkCallback: (checking) => {
        // a focused item in the file tree wins over the open note
        const path = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('.nav-files-container [data-path]')?.dataset.path
        const file = (path && this.vault.getAbstractFileByPath(path)) || this.workspace.getActiveFile()
        if (!file) return false
        if (!checking) void renameWithPrompt(this, file)
        return true
      },
    })
    c.addCommand({
      id: 'file:delete', name: 'Видалити поточну нотатку', checkCallback: (checking) => {
        const file = this.workspace.getActiveFile()
        if (!file) return false
        if (!checking) void trashWithUndo(this, file)
        return true
      },
    })
    c.addCommand({
      id: 'markdown:toggle-preview', name: 'Перемкнути режим читання', hotkeys: [{ modifiers: ['Mod'], key: 'e' }],
      checkCallback: (checking) => {
        const view = this.workspace.getActiveMarkdownView()
        if (!view) return false
        if (!checking) void view.setMode(view.getMode() === 'source' ? 'preview' : 'source')
        return true
      },
    })
    c.addCommand({
      id: 'editor:follow-link', name: 'Перейти за посиланням під курсором', hotkeys: [{ modifiers: ['Alt'], key: 'Enter' }],
      editorCheckCallback: (checking, editor, view) => {
        const hit = linkAt(editor.cm.state, editor.cm.state.selection.main.head)
        if (!hit || hit.external) return false
        if (!checking) void view.save().then(() => this.workspace.openLinkText(hit.link, view.file?.path ?? ''))
        return true
      },
    })
  }
}
