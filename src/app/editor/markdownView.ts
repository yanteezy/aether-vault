/**
 * The note view: CodeMirror 6 with live preview inside Obsidian's DOM
 * (`.markdown-source-view.mod-cm6.is-live-preview > .cm-editor`).
 * Saves 400 ms after the last keystroke, on switching files, on close and before the window closes.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import { TFile } from '../../core/vault/files.js'
import { Notice } from '../ui.js'
import { FileView, type WorkspaceLeaf } from '../workspace.js'
import { Editor } from './editor.js'
import { editorInfoField, editorLivePreviewField } from './fields.js'
import { livePreview } from './livePreview.js'
import { MarkdownPreview } from './render.js'
import { mergeText } from '../../core/merge.js'

const SAVE_DELAY = 400

/** Colours for the dark theme; CodeMirror's default style is made for light backgrounds. */
const highlight = HighlightStyle.define([
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.punctuation], color: 'var(--text-faint)' },
  { tag: t.atom, color: 'var(--text-muted)' },
  { tag: t.url, color: 'var(--text-accent)' },
  { tag: t.monospace, fontFamily: 'var(--font-monospace)' },
])

export class MarkdownView extends FileView {
  editor: Editor
  /** Text last read from or written to disk. */
  data = ''
  private readonly plugins = new Compartment()
  private mode: 'source' | 'preview' = 'source'
  private readonly sourceEl: HTMLElement
  /** the reading view (Obsidian calls it `previewMode`) */
  readonly previewMode: MarkdownPreview
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private saving: Promise<void> = Promise.resolve()
  /** true while our own save is on its way to disk: its `modify` event is not someone else's change */
  private writing = false
  override icon = 'document'

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    const host = this.contentEl.createDiv('markdown-source-view cm-s-obsidian mod-cm6 is-live-preview is-readable-line-width')
    const cm = new EditorView({ parent: host, state: this.newState('') })
    this.editor = new Editor(cm)
    this.sourceEl = host
    this.previewMode = this.addChild(new MarkdownPreview(this.app, this.contentEl, (link, newTab) => this.openLink(link, false, newTab)))
    this.previewMode.containerEl.hide()
  }

  getViewType() { return 'markdown' }
  getMode(): 'source' | 'preview' { return this.mode }
  /** Obsidian's mode object: the editor (`sourceMode: false` = live preview) or the reading view. */
  get currentMode() { return this.mode === 'source' ? { type: 'source' as const, sourceMode: false } : { type: 'preview' as const } }

  /** Switches between editing and reading; the reading view shows the saved text. */
  async setMode(mode: 'source' | 'preview') {
    if (mode === 'preview') {
      await this.save()
      await this.previewMode.render(this.getViewData(), this.file)
    }
    this.mode = mode
    this.sourceEl.toggle(mode === 'source')
    this.previewMode.containerEl.toggle(mode === 'preview')
    if (mode === 'source') this.editor.focus()
    else this.previewMode.containerEl.focus()
    this.app.workspace.requestLayoutChange()
  }
  getState(): Record<string, unknown> { return { ...super.getState(), mode: this.mode } }

  private newState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        editorInfoField.init(() => this),
        editorLivePreviewField.init(() => true),
        history(),
        drawSelection(),
        indentOnInput(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        placeholder('Почніть писати…'),
        EditorView.contentAttributes.of({ 'aria-label': 'Текст нотатки', spellcheck: 'true' }),
        livePreview((link, external, newTab) => this.openLink(link, external, newTab)),
        Prec.highest(EditorView.domEventHandlers({ keydown: (e) => this.app.workspace.editorSuggestScopeKey(e) })),
        Prec.highest(keymap.of([
          { key: 'ArrowDown', run: () => this.app.workspace.editorSuggestKey('down') },
          { key: 'ArrowUp', run: () => this.app.workspace.editorSuggestKey('up') },
          { key: 'Enter', run: () => this.app.workspace.editorSuggestKey('enter') },
          { key: 'Tab', run: () => this.app.workspace.editorSuggestKey('enter') },
          { key: 'Escape', run: () => this.app.workspace.editorSuggestKey('escape') },
        ])),
        EditorView.updateListener.of((u) => {
          if (u.focusChanged && !u.view.hasFocus) this.app.workspace.closeEditorSuggest()
          const typed = u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))
          if (typed) void this.app.workspace.updateEditorSuggest(this)
          else if (u.selectionSet) this.app.workspace.closeEditorSuggest()
          if (!u.docChanged) return
          this.requestSave()
          this.app.workspace.trigger('editor-change', this.editor, this)
        }),
        this.plugins.of([...this.app.workspace.editorExtensions]),
      ],
    })
  }

  /** @internal plugin editor extensions changed */
  reconfigure() {
    this.editor.cm.dispatch({ effects: this.plugins.reconfigure([...this.app.workspace.editorExtensions]) })
  }

  async onOpen() {
    this.registerEvent(this.app.vault.on('modify', (f) => {
      // a plugin or another view changed the file: show it, unless it is what we wrote ourselves
      if (f !== this.file) return
      if (!this.isDirty()) void this.reloadFromDisk()
      else if (!this.writing) void this.mergeFromDisk()
    }))
    this.registerEvent(this.app.vault.on('rename', (f) => { if (f === this.file) this.leaf.updateHeader() }))
    this.registerEvent(this.app.vault.on('delete', (f) => { if (f === this.file) { this.file = null; void this.leaf.detach() } }))
  }

  async onLoadFile(file: TFile) {
    this.data = await this.app.vault.read(file)
    this.setViewData(this.data, true)
    if (this.mode === 'preview') await this.previewMode.render(this.data, file)
  }

  async onUnloadFile(_file: TFile) {
    await this.save()
  }

  async onClose() {
    await this.save()
    this.editor.cm.destroy()
  }

  getViewData() { return this.editor.getValue() }
  /** `clear`: a different file, so a fresh undo history. */
  setViewData(data: string, clear: boolean) {
    if (clear) this.editor.cm.setState(this.newState(data))
    else this.editor.setValue(data)
  }

  isDirty() {
    return this.file !== null && this.getViewData() !== this.data
  }

  requestSave() {
    clearTimeout(this.saveTimer)
    this.app.setSaveState('pending')
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY)
  }

  /** Writes the note if it changed. Saves run one after another, never two at once. */
  save(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saving = this.saving.then(async () => {
      const file = this.file
      if (!file || !this.isDirty()) return
      const text = this.getViewData()
      try {
        this.writing = true
        await this.app.vault.modify(file, text).finally(() => { this.writing = false })
        this.data = text
        this.app.setSaveState(this.app.hasUnsaved() ? 'pending' : 'saved')
      } catch (e) {
        console.error(e)
        this.app.setSaveState('error')
        new Notice(`Не вдалося зберегти «${file.basename}». Текст лишився в редакторі.`)
      }
    })
    return this.saving
  }

  /**
   * Someone else changed the file while we have unsaved text. Edits in different places are combined;
   * if both changed the same lines, the editor keeps ours and theirs is saved next to it, so nothing is lost.
   */
  private async mergeFromDisk() {
    const file = this.file
    if (!file) return
    const theirs = await this.app.vault.read(file)
    if (theirs === this.data) return
    const ours = this.getViewData()
    const { text, conflict } = mergeText(this.data, ours, theirs)
    this.data = theirs // what is on disk now: our next save overwrites only that
    if (!conflict) {
      const cursor = this.editor.cm.state.selection.main.head
      this.setViewData(text, false)
      this.editor.cm.dispatch({ selection: { anchor: Math.min(cursor, text.length) } })
      new Notice(`«${file.basename}» змінила інша програма. Її зміни об'єднано з вашими.`)
      this.requestSave()
      return
    }
    const copy = await this.app.createNote(`${file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : ''}${file.basename} (зміни іншої програми)`, theirs)
    new Notice(`«${file.basename}» змінила інша програма в тих самих місцях, що й ви. Ваш текст лишився тут, а її версію збережено як «${copy.basename}».`, 12000)
    this.requestSave()
  }

  private async reloadFromDisk() {
    if (!this.file) return
    const text = await this.app.vault.read(this.file)
    if (text === this.getViewData()) return
    this.data = text
    this.setViewData(text, false)
    if (this.mode === 'preview') await this.previewMode.render(text, this.file)
  }

  private openLink(link: string, external: boolean, newTab: boolean) {
    if (external) {
      // electron is there at run time; tests run without it
      void import('electron').then(({ shell }) => shell.openExternal(link)).catch(() => window.open(link))
      return
    }
    void this.save().then(() => this.app.workspace.openLinkText(link, this.file?.path ?? '', newTab))
  }
}
