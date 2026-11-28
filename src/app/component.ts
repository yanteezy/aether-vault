/**
 * `Component`, `Plugin` and `PluginSettingTab` with the public shape from obsidian.d.ts.
 * Everything a component registers is undone when it unloads, so disabling a plugin leaves nothing behind.
 */
import type { EventRef, Events } from '../core/events.js'
import type { App } from './app.js'
import type { Command } from './commands.js'
import { setIcon } from './icons.js'
import type { View, WorkspaceLeaf } from './workspace.js'
import type { EditorSuggest } from './editor/suggest.js'
import type { CodeBlockProcessor, MarkdownPostProcessor } from './editor/render.js'
import type { Extension } from '@codemirror/state'

export class Component {
  private _loaded = false
  private _children: Component[] = []
  private _cleanups: (() => unknown)[] = []

  /** Returns what `onload` returned, so the plugin manager can wait for an async `onload`. */
  load(): any {
    if (this._loaded) return
    this._loaded = true
    const result = this.onload()
    for (const c of this._children) c.load()
    return result
  }
  onload(): void | Promise<void> {}

  unload() {
    if (!this._loaded) return
    this._loaded = false
    for (const c of this._children.splice(0)) c.unload()
    for (const fn of this._cleanups.splice(0).reverse()) {
      try { fn() } catch (e) { console.error(e) }
    }
    this.onunload()
  }
  onunload() {}

  addChild<T extends Component>(child: T): T {
    this._children.push(child)
    if (this._loaded) child.load()
    return child
  }
  removeChild<T extends Component>(child: T): T {
    this._children = this._children.filter((c) => c !== child)
    child.unload()
    return child
  }

  register(cb: () => unknown) {
    this._cleanups.push(cb)
  }
  registerEvent(ref: EventRef) {
    this.register(() => (ref as { e: Events }).e.offref(ref))
  }
  registerDomEvent(el: EventTarget, type: string, callback: (ev: any) => any, options?: boolean | AddEventListenerOptions) {
    el.addEventListener(type, callback, options)
    this.register(() => el.removeEventListener(type, callback, options))
  }
  registerInterval(id: number) {
    this.register(() => clearInterval(id))
    return id
  }
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  minAppVersion?: string
  description?: string
  author?: string
  authorUrl?: string
  isDesktopOnly?: boolean
  /** Vault-relative folder of the plugin, set by the plugin manager. */
  dir?: string
}

export abstract class PluginSettingTab {
  app: App
  plugin: Plugin
  containerEl: HTMLElement
  /** @internal name in the settings list */
  name: string

  constructor(app: App, plugin: Plugin) {
    this.app = app
    this.plugin = plugin
    this.name = plugin.manifest.name
    this.containerEl = createDiv('vertical-tab-content')
  }
  abstract display(): void
  hide() {
    this.containerEl.empty()
  }
}

export class Plugin extends Component {
  app: App
  manifest: PluginManifest

  constructor(app: App, manifest: PluginManifest) {
    super()
    this.app = app
    this.manifest = manifest
  }

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const el = this.app.workspace.dockPluginsEl.createEl('button', {
      cls: 'clickable-icon side-dock-ribbon-action',
      attr: { 'aria-label': title, title },
    })
    setIcon(el, icon)
    el.addEventListener('click', callback)
    this.register(() => el.remove())
    return el
  }

  addStatusBarItem(): HTMLElement {
    const el = this.app.statusBarEl.createDiv(`status-bar-item plugin-${this.manifest.id}`)
    this.register(() => el.remove())
    return el
  }

  addCommand(command: Command): Command {
    const full = { ...command, id: `${this.manifest.id}:${command.id}`, name: `${this.manifest.name}: ${command.name}` }
    this.app.commands.addCommand(full)
    this.register(() => this.app.commands.removeCommand(full.id))
    return full
  }

  addSettingTab(tab: PluginSettingTab) {
    this.app.setting.addTab(tab)
    this.register(() => this.app.setting.removeTab(tab))
  }

  /** Files with these extensions open in the view `viewType`. */
  registerExtensions(extensions: string[], viewType: string) {
    for (const ext of extensions) this.app.extensionViews.set(ext.toLowerCase(), viewType)
    this.register(() => { for (const ext of extensions) this.app.extensionViews.delete(ext.toLowerCase()) })
  }

  registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => View) {
    this.app.viewRegistry.set(type, viewCreator)
    this.register(() => {
      this.app.workspace.detachLeavesOfType(type)
      this.app.viewRegistry.delete(type)
    })
  }

  registerEditorExtension(extension: Extension) {
    this.app.workspace.addEditorExtension(extension)
    this.register(() => this.app.workspace.removeEditorExtension(extension))
  }

  registerEditorSuggest(suggest: EditorSuggest<any>) {
    const list = this.app.workspace.editorSuggests
    list.push(suggest)
    this.register(() => {
      suggest.close()
      list.splice(list.indexOf(suggest), 1)
    })
  }

  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => any) {
    this.app.protocolHandlers.set(action, handler)
    this.register(() => this.app.protocolHandlers.delete(action))
  }

  registerHoverLinkSource(id: string, info: { display: string; defaultMod: boolean }) {
    this.app.workspace.registerHoverLinkSource(id, info)
    this.register(() => this.app.workspace.unregisterHoverLinkSource(id))
  }

  /** Runs on every block of the reading view. */
  registerMarkdownPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number) {
    if (sortOrder !== undefined) postProcessor.sortOrder = sortOrder
    this.app.markdownPostProcessors.add(postProcessor)
    this.register(() => this.app.markdownPostProcessors.delete(postProcessor))
    return postProcessor
  }

  /** Renders ```lang blocks in the reading view. */
  registerMarkdownCodeBlockProcessor(language: string, handler: CodeBlockProcessor) {
    this.app.codeBlockProcessors.set(language, handler)
    this.register(() => this.app.codeBlockProcessors.delete(language))
  }

  private get dataPath() {
    return `${this.manifest.dir}/data.json`
  }
  async loadData(): Promise<any> {
    const adapter = this.app.vault.adapter
    return (await adapter.exists(this.dataPath)) ? JSON.parse(await adapter.read(this.dataPath)) : null
  }
  async saveData(data: unknown) {
    await this.app.vault.adapter.mkdir(this.manifest.dir!)
    await this.app.vault.adapter.write(this.dataPath, JSON.stringify(data, null, 2))
  }
}
