/** Commands (`addCommand`), their hotkeys and the command palette (Ctrl/⌘+P). */
import type { App } from './app.js'
import type { Editor } from './editor/editor.js'
import type { MarkdownView } from './editor/markdownView.js'
import { Modal } from './ui.js'

export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt'
export interface Hotkey { modifiers: Modifier[]; key: string }

export interface Command {
  id: string
  name: string
  icon?: string
  hotkeys?: Hotkey[]
  callback?: () => any
  checkCallback?: (checking: boolean) => boolean | void
  editorCallback?: (editor: Editor, view: MarkdownView) => any
  editorCheckCallback?: (checking: boolean, editor: Editor, view: MarkdownView) => boolean | void
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

export function matchesHotkey(e: KeyboardEvent, h: Hotkey) {
  const want = new Set(h.modifiers.map((m) => (m === 'Mod' ? (isMac ? 'Meta' : 'Ctrl') : m)))
  return (
    e.key.toLowerCase() === h.key.toLowerCase() &&
    e.ctrlKey === want.has('Ctrl') && e.metaKey === want.has('Meta') && e.shiftKey === want.has('Shift') && e.altKey === want.has('Alt')
  )
}

export function hotkeyLabel(h: Hotkey) {
  const names: Record<string, string> = { Mod: isMac ? '⌘' : 'Ctrl', Ctrl: 'Ctrl', Meta: '⌘', Shift: 'Shift', Alt: isMac ? '⌥' : 'Alt' }
  return [...h.modifiers.map((m) => names[m]), h.key === ' ' ? 'Space' : h.key.length === 1 ? h.key.toUpperCase() : h.key].join(isMac ? '' : '+')
}

export class Commands {
  readonly commands: Record<string, Command> = {}
  constructor(private readonly app: App) {}

  addCommand(cmd: Command) {
    this.commands[cmd.id] = cmd
  }
  removeCommand(id: string) {
    delete this.commands[id]
  }
  findCommand(id: string): Command | undefined {
    return this.commands[id]
  }

  /** Runs the command, or with `checking` says whether it can run now. */
  private run(cmd: Command, checking: boolean): boolean {
    const view = this.app.workspace.getActiveMarkdownView()
    if (cmd.editorCheckCallback) return !!view && cmd.editorCheckCallback(checking, view.editor, view) !== false
    if (cmd.editorCallback) {
      if (!view) return false
      if (!checking) cmd.editorCallback(view.editor, view)
      return true
    }
    if (cmd.checkCallback) return cmd.checkCallback(checking) !== false
    if (!checking) cmd.callback?.()
    return !!cmd.callback
  }

  listAvailable(): Command[] {
    return Object.values(this.commands)
      .filter((c) => this.safe(() => this.run(c, true)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  executeCommandById(id: string): boolean {
    const cmd = this.commands[id]
    return !!cmd && this.safe(() => this.run(cmd, true) && (this.run(cmd, false), true))
  }

  /** Global keydown: the first command whose hotkey matches and that can run. */
  handleKey(e: KeyboardEvent): boolean {
    for (const cmd of Object.values(this.commands)) {
      if (cmd.hotkeys?.some((h) => matchesHotkey(e, h)) && this.executeCommandById(cmd.id)) {
        e.preventDefault()
        return true
      }
    }
    return false
  }

  /** A broken plugin command must not break the palette. */
  private safe(fn: () => boolean) {
    try { return fn() } catch (e) { console.error(e); return false }
  }
}

export class CommandPalette extends Modal {
  private input!: HTMLInputElement
  private list!: HTMLElement
  private items: Command[] = []
  private selected = 0

  onOpen() {
    this.modalEl.addClass('prompt')
    this.titleEl.setText('Команди')
    this.titleEl.addClass('sr-only')
    this.input = this.contentEl.createEl('input', {
      cls: 'prompt-input',
      type: 'text',
      placeholder: 'Знайти команду…',
      attr: { role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-label': 'Знайти команду' },
    })
    this.list = this.contentEl.createDiv({ cls: 'prompt-results', attr: { id: 'palette-list', role: 'listbox' } })
    this.input.addEventListener('input', () => this.render())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        this.selected = (this.selected + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % Math.max(1, this.items.length)
        this.highlight()
      } else if (e.key === 'Enter' && this.items[this.selected]) {
        e.preventDefault()
        this.choose(this.items[this.selected])
      }
    })
    this.render()
  }

  private render() {
    const q = this.input.value.trim().toLowerCase()
    this.items = this.app.commands.listAvailable().filter((c) => c.name.toLowerCase().includes(q))
    this.selected = 0
    this.list.empty()
    if (!this.items.length) this.list.createDiv({ cls: 'suggestion-empty', text: 'Нічого не знайдено' })
    this.items.forEach((cmd, i) => {
      const el = this.list.createDiv({ cls: 'suggestion-item', attr: { role: 'option', id: `palette-${i}` } })
      el.createSpan({ cls: 'suggestion-title', text: cmd.name })
      for (const h of cmd.hotkeys ?? []) el.createEl('kbd', { cls: 'suggestion-hotkey', text: hotkeyLabel(h) })
      el.addEventListener('mousemove', () => { this.selected = i; this.highlight() })
      el.addEventListener('click', () => this.choose(cmd))
    })
    this.highlight()
  }

  private highlight() {
    ;[...this.list.children].forEach((el, i) => {
      el.toggleClass('is-selected', i === this.selected)
      el.setAttr('aria-selected', i === this.selected)
    })
    this.input.setAttr('aria-activedescendant', this.items.length ? `palette-${this.selected}` : null)
    this.list.children[this.selected]?.scrollIntoView?.({ block: 'nearest' })
  }

  private choose(cmd: Command) {
    this.close()
    this.app.commands.executeCommandById(cmd.id)
  }
}

export type PaneType = 'tab' | 'split' | 'window'

export class Keymap {
  /** Which pane a modified click should open in, as in Obsidian: Mod → tab, Mod+Alt → split, Mod+Alt+Shift → window. */
  static isModEvent(evt?: MouseEvent | KeyboardEvent | null): PaneType | boolean {
    if (!evt) return false
    const mod = isMac ? evt.metaKey : evt.ctrlKey
    if (mod && evt.altKey && evt.shiftKey) return 'window'
    if (mod && evt.altKey) return 'split'
    if (mod || (evt instanceof MouseEvent && evt.button === 1)) return 'tab'
    return false
  }
  static isModifier(evt: MouseEvent | KeyboardEvent, modifier: Modifier) {
    const key = modifier === 'Mod' ? (isMac ? 'metaKey' : 'ctrlKey') : (`${modifier.toLowerCase()}Key` as 'ctrlKey')
    return evt[key]
  }
}

export interface KeymapEventHandler { scope: Scope; modifiers: Modifier[] | null; key: string | null; func: (evt: KeyboardEvent) => any }

/** Extra hotkeys that apply only while something (a suggest list, a modal) is open. */
export class Scope {
  private readonly handlers: KeymapEventHandler[] = []
  constructor(readonly parent?: Scope) {}

  register(modifiers: Modifier[] | null, key: string | null, func: (evt: KeyboardEvent) => any): KeymapEventHandler {
    const h = { scope: this, modifiers, key, func }
    this.handlers.push(h)
    return h
  }
  unregister(handler: KeymapEventHandler) {
    const i = this.handlers.indexOf(handler)
    if (i >= 0) this.handlers.splice(i, 1)
  }

  /** @internal Runs the first matching handler; Obsidian treats a `false` return as "not handled". */
  handle(evt: KeyboardEvent): boolean {
    for (const h of this.handlers) {
      const keyOk = h.key === null || h.key.toLowerCase() === evt.key.toLowerCase()
      const modsOk = h.modifiers === null || matchesHotkey(evt, { modifiers: h.modifiers, key: evt.key })
      if (keyOk && modsOk && h.func(evt) !== false) return true
    }
    return this.parent?.handle(evt) ?? false
  }
}
