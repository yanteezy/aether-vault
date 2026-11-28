/** Obsidian's `Editor` API over a CodeMirror 6 view. Lines and `ch` are 0-based, as in Obsidian. */
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'

export interface EditorPosition { line: number; ch: number }
export interface EditorRange { from: EditorPosition; to: EditorPosition }

export class Editor {
  /** The CodeMirror view; plugins reach it as `editor.cm`. */
  constructor(readonly cm: EditorView) {}

  private get doc() { return this.cm.state.doc }

  getValue() { return this.doc.toString() }
  setValue(content: string) { this.cm.dispatch({ changes: { from: 0, to: this.doc.length, insert: content } }) }
  getLine(line: number) { return this.doc.line(line + 1).text }
  setLine(n: number, text: string) { const l = this.doc.line(n + 1); this.cm.dispatch({ changes: { from: l.from, to: l.to, insert: text } }) }
  lineCount() { return this.doc.lines }
  lastLine() { return this.doc.lines - 1 }

  posToOffset(pos: EditorPosition) {
    const line = this.doc.line(Math.min(Math.max(pos.line, 0), this.lastLine()) + 1)
    return Math.min(line.from + pos.ch, line.to)
  }
  offsetToPos(offset: number): EditorPosition {
    const line = this.doc.lineAt(Math.min(Math.max(offset, 0), this.doc.length))
    return { line: line.number - 1, ch: offset - line.from }
  }

  getCursor(which: 'from' | 'to' | 'head' | 'anchor' = 'head'): EditorPosition {
    const r = this.cm.state.selection.main
    return this.offsetToPos(r[which])
  }
  setCursor(pos: EditorPosition | number, ch?: number) {
    const p = typeof pos === 'number' ? { line: pos, ch: ch ?? 0 } : pos
    this.cm.dispatch({ selection: { anchor: this.posToOffset(p) }, scrollIntoView: true })
  }
  setSelection(anchor: EditorPosition, head?: EditorPosition) {
    this.cm.dispatch({ selection: { anchor: this.posToOffset(anchor), head: this.posToOffset(head ?? anchor) } })
  }
  listSelections(): { anchor: EditorPosition; head: EditorPosition }[] {
    return this.cm.state.selection.ranges.map((r) => ({ anchor: this.offsetToPos(r.anchor), head: this.offsetToPos(r.head) }))
  }
  somethingSelected() { return this.cm.state.selection.ranges.some((r) => !r.empty) }
  getSelection() { const r = this.cm.state.selection.main; return this.cm.state.sliceDoc(r.from, r.to) }
  replaceSelection(text: string) {
    this.cm.dispatch(this.cm.state.changeByRange((r) => ({ changes: { from: r.from, to: r.to, insert: text }, range: EditorSelection.cursor(r.from + text.length) })))
  }
  getRange(from: EditorPosition, to: EditorPosition) { return this.cm.state.sliceDoc(this.posToOffset(from), this.posToOffset(to)) }
  replaceRange(text: string, from: EditorPosition, to?: EditorPosition) {
    this.cm.dispatch({ changes: { from: this.posToOffset(from), to: this.posToOffset(to ?? from), insert: text } })
  }

  focus() { this.cm.focus() }
  blur() { this.cm.contentDOM.blur() }
  hasFocus() { return this.cm.hasFocus }
  undo() { undo(this.cm) }
  redo() { redo(this.cm) }
  refresh() { this.cm.requestMeasure() }
  scrollIntoView(range: EditorRange) {
    this.cm.dispatch({ effects: EditorView.scrollIntoView(this.posToOffset(range.from)) })
  }
}
