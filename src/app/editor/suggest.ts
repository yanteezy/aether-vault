/**
 * `PopoverSuggest` / `EditorSuggest` as in obsidian.d.ts: a pop-up list under the cursor
 * (e.g. "@today" → a date). DOM: `.suggestion-container > .suggestion > .suggestion-item`.
 */
import type { TFile } from '../../core/vault/files.js'
import type { App } from '../app.js'
import type { Editor, EditorPosition } from './editor.js'
import { Scope } from '../commands.js'

export interface EditorSuggestTriggerInfo { start: EditorPosition; end: EditorPosition; query: string }
export interface EditorSuggestContext extends EditorSuggestTriggerInfo { editor: Editor; file: TFile | null }
export interface Instruction { command: string; purpose: string }

let listCounter = 0

export abstract class PopoverSuggest<T> {
  app: App
  containerEl: HTMLElement
  /** keys for the open list; plugins add their own, e.g. Shift+Enter */
  scope: Scope
  protected values: T[] = []
  protected selected = 0
  private listEl: HTMLElement
  private instructionsEl: HTMLElement
  private readonly listId = `suggest-${++listCounter}`

  constructor(app: App, scope?: Scope) {
    this.app = app
    this.scope = new Scope(scope)
    this.containerEl = createDiv('suggestion-container')
    this.listEl = this.containerEl.createDiv({ cls: 'suggestion', attr: { role: 'listbox', id: this.listId, 'aria-label': 'Підказки' } })
    this.instructionsEl = this.containerEl.createDiv('prompt-instructions')
    // keep the editor focused while clicking a suggestion
    this.containerEl.addEventListener('mousedown', (e) => e.preventDefault())
  }

  get isOpen() { return this.containerEl.isConnected }
  open() { if (!this.isOpen) document.body.appendChild(this.containerEl) }
  close() { this.containerEl.remove() }

  abstract renderSuggestion(value: T, el: HTMLElement): void
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void

  setInstructions(instructions: Instruction[]) {
    this.instructionsEl.empty()
    for (const i of instructions) {
      const row = this.instructionsEl.createDiv('prompt-instruction')
      row.createSpan({ cls: 'prompt-instruction-command', text: i.command })
      row.createSpan({ text: i.purpose })
    }
  }

  /** @internal */
  setSuggestions(values: T[]) {
    this.values = values
    this.selected = 0
    this.listEl.empty()
    values.forEach((v, i) => {
      const el = this.listEl.createDiv({ cls: 'suggestion-item', attr: { role: 'option', id: `${this.listId}-${i}` } })
      try { this.renderSuggestion(v, el) } catch (e) { console.error(e) }
      el.addEventListener('mousemove', () => this.select(i))
      el.addEventListener('click', (e) => this.choose(e))
    })
    this.select(0)
  }

  /** @internal */
  moveSelection(delta: number) {
    if (this.values.length) this.select((this.selected + delta + this.values.length) % this.values.length)
  }

  /** @internal */
  choose(evt: MouseEvent | KeyboardEvent) {
    const value = this.values[this.selected]
    this.close()
    if (value !== undefined) this.selectSuggestion(value, evt)
  }

  /** id of the highlighted option, for aria-activedescendant on the editor */
  get activeId() { return this.values.length ? `${this.listId}-${this.selected}` : null }

  private select(i: number) {
    this.selected = i
    ;[...this.listEl.children].forEach((el, n) => {
      el.toggleClass('is-selected', n === i)
      el.setAttr('aria-selected', n === i)
    })
    this.listEl.children[i]?.scrollIntoView?.({ block: 'nearest' })
  }
}

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: EditorSuggestContext | null = null
  limit = 100

  abstract onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null
  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>

  close() {
    super.close()
    this.context = null
  }

  /** @internal Shows the list if this suggest triggers at the cursor; returns whether it did. */
  async update(editor: Editor, file: TFile | null): Promise<boolean> {
    const info = this.onTrigger(editor.getCursor(), editor, file)
    if (!info) { this.close(); return false }
    const context = { ...info, editor, file }
    this.context = context
    const items = await this.getSuggestions(context)
    if (this.context !== context) return false // the user typed on meanwhile
    if (!items?.length) { this.close(); return false }
    this.setSuggestions(items.slice(0, this.limit))
    const at = editor.cm.coordsAtPos(editor.posToOffset(info.start))
    if (at) Object.assign(this.containerEl.style, { left: `${at.left}px`, top: `${at.bottom + 4}px` })
    this.open()
    return true
  }
}
