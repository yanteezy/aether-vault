/**
 * Live preview for CodeMirror 6: Markdown formatting is shown styled and its marks (#, **, [[ ]], …) are hidden,
 * except on the lines the cursor is on. Class names follow the ones Obsidian themes style
 * (HyperMD-header-N, cm-header-N, cm-strong, cm-em, cm-hmd-internal-link, cm-hashtag, cm-inline-code, HyperMD-codeblock).
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { MD_LINK, TAG, WIKI } from '../../core/metadata/parse.js'

const hide = Decoration.replace({})
const mark = (cls: string) => Decoration.mark({ class: cls })
const line = (cls: string) => Decoration.line({ class: cls })
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText'])

/** `-` / `*` / `+` of a bullet list, drawn as a dot. */
class Bullet extends WidgetType {
  eq() { return true }
  toDOM() { return createSpan({ cls: 'list-bullet', text: '•', attr: { 'aria-hidden': 'true' } }) }
}
/** `- [ ]` / `- [x]` drawn as a checkbox; a click toggles the `x` in the text. */
class Checkbox extends WidgetType {
  constructor(readonly checked: boolean) { super() }
  eq(o: Checkbox) { return o.checked === this.checked }
  toDOM() {
    const box = createEl('input', { cls: 'task-list-item-checkbox', type: 'checkbox', attr: { 'aria-label': 'Виконано' } })
    box.checked = this.checked
    return box
  }
  ignoreEvent() { return false }
}

/** A GFM table drawn as a real <table>; a click puts the cursor at its start so the Markdown can be edited. */
class TableWidget extends WidgetType {
  constructor(readonly rows: string[][]) { super() }
  eq(o: TableWidget) { return JSON.stringify(o.rows) === JSON.stringify(this.rows) }
  toDOM() {
    const table = document.createElement('table')
    table.className = 'cm-md-table'
    this.rows.forEach((cells, i) => {
      const section = table.appendChild(document.createElement(i === 0 ? 'thead' : 'tbody'))
      const tr = section.appendChild(document.createElement('tr'))
      for (const c of cells) {
        const cell = tr.appendChild(document.createElement(i === 0 ? 'th' : 'td'))
        if (i === 0) cell.scope = 'col'
        cell.textContent = c // plain text: inline marks are not rendered (shortcut)
      }
    })
    return table
  }
  ignoreEvent() { return false }
}

/** Off-cursor tables become block widgets. Block replaces spanning lines must come from a StateField, not the ViewPlugin. */
export function tableDecorations(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const inside = state.selection.ranges.some((r) => r.from <= node.to && r.to >= node.from)
      if (!inside) {
        const rows: string[][] = []
        for (const row of node.node.getChildren('TableHeader').concat(node.node.getChildren('TableRow')).sort((a, b) => a.from - b.from)) {
          rows.push(row.getChildren('TableCell').map((c) => state.sliceDoc(c.from, c.to).trim()))
        }
        if (rows.length) out.push(Decoration.replace({ widget: new TableWidget(rows), block: true }).range(node.from, node.to))
      }
      return false
    },
  })
  return Decoration.set(out, true)
}

const tableField = StateField.define<DecorationSet>({
  create: tableDecorations,
  update: (value, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? tableDecorations(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
})

/** End offset of the YAML block at the top, 0 when there is none (the Markdown parser does not know YAML). */
export function frontmatterEnd(doc: Text) {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return 0
  for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text.trimEnd() === '---') return doc.line(n).to
  return 0
}

/** `focused` false: the editor is not being typed in, so no line counts as the one being edited. */
export function livePreviewDecorations(state: EditorState, visible: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }], focused = true): DecorationSet {
  const doc = state.doc
  const out: Range<Decoration>[] = []
  const active = new Set<number>()
  if (focused) for (const r of state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n)
  }
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number)
  const tree = syntaxTree(state)
  const inCode = (pos: number) => {
    for (let n: { name: string; parent: any } | null = tree.resolveInner(pos, 1); n; n = n.parent) if (CODE.has(n.name)) return true
    return false
  }
  const fm = frontmatterEnd(doc)
  if (fm) for (let n = 1; n <= doc.lineAt(fm).number; n++) out.push(line('cm-hmd-frontmatter').range(doc.line(n).from))

  const eachLine = (from: number, to: number, cls: string) => {
    for (let pos = from; pos <= to; ) {
      const l = doc.lineAt(pos)
      out.push(line(cls).range(l.from))
      pos = l.to + 1
    }
  }

  for (const { from, to } of visible) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'Document') return
        if (node.from < fm) return false // YAML read as Markdown is nonsense
        const h = /^ATXHeading(\d)$/.exec(node.name)
        if (h) {
          out.push(line(`HyperMD-header HyperMD-header-${h[1]}`).range(doc.lineAt(node.from).from))
          if (node.to > node.from) out.push(mark(`cm-header cm-header-${h[1]}`).range(node.from, node.to))
          return
        }
        switch (node.name) {
          case 'HeaderMark':
            if (!isActive(node.from)) out.push(hide.range(node.from, doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to))
            return
          case 'QuoteMark':
            if (!isActive(node.from)) out.push(hide.range(node.from, doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to))
            return
          case 'Table': return false // drawn by the table field
          case 'Emphasis': out.push(mark('cm-em').range(node.from, node.to)); return
          case 'StrongEmphasis': out.push(mark('cm-strong').range(node.from, node.to)); return
          case 'Strikethrough': out.push(mark('cm-strikethrough').range(node.from, node.to)); return
          case 'InlineCode': out.push(mark('cm-inline-code').range(node.from, node.to)); return
          case 'ListMark': {
            const item = node.node.parent
            if (isActive(node.from) || item?.parent?.name !== 'BulletList' || item.getChild('Task')) return
            out.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to))
            return
          }
          case 'TaskMarker': {
            const listMark = node.node.parent?.parent?.getChild('ListMark')
            if (!listMark || isActive(node.from)) return
            const checked = /x/i.test(doc.sliceString(node.from, node.to))
            out.push(Decoration.replace({ widget: new Checkbox(checked) }).range(listMark.from, node.to))
            return
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) out.push(hide.range(node.from, node.to))
            return
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) out.push(hide.range(node.from, node.to))
            return
          case 'Link': {
            const marks = node.node.getChildren('LinkMark')
            const url = node.node.getChild('URL')
            // `[text]` without a URL is part of a [[wiki link]] or a reference: leave it to the wiki pass
            if (!url || marks.length < 2) return false
            const external = EXTERNAL.test(doc.sliceString(url.from, url.to))
            if (marks[1].from > marks[0].to) out.push(mark(external ? 'cm-link cm-url-link' : 'cm-hmd-internal-link').range(marks[0].to, marks[1].from))
            if (!isActive(node.from)) {
              out.push(hide.range(node.from, marks[0].to))
              out.push(hide.range(marks[1].from, node.to))
            }
            return false
          }
          case 'URL':
            if (node.node.parent?.name !== 'Link') out.push(mark('cm-url').range(node.from, node.to))
            return
          case 'Blockquote':
            eachLine(node.from, node.to, 'HyperMD-quote')
            return
          case 'FencedCode':
            eachLine(node.from, node.to, 'HyperMD-codeblock')
            return false
        }
      },
    })

    for (let pos = Math.max(from, fm ? fm + 1 : 0); pos <= to && pos <= doc.length; ) {
      const l = doc.lineAt(pos)
      pos = l.to + 1
      const lineActive = active.has(l.number)
      for (const m of l.text.matchAll(WIKI)) {
        const s = l.from + m.index
        if (inCode(s)) continue
        const e = s + m[0].length
        const inner = s + m[1].length + 2
        const textFrom = m[3] !== undefined ? inner + m[2].length + 1 : inner
        const textTo = e - 2
        if (textTo > textFrom) out.push(mark(m[1] ? 'cm-hmd-internal-link cm-hmd-embed' : 'cm-hmd-internal-link').range(textFrom, textTo))
        if (!lineActive) {
          out.push(hide.range(s, textFrom))
          out.push(hide.range(textTo, e))
        }
      }
      for (const m of l.text.matchAll(TAG)) {
        const at = l.from + m.index + m[1].length
        if (/^\d+$/.test(m[2]) || inCode(at)) continue
        out.push(mark('cm-hashtag').range(at, at + m[2].length + 1))
      }
    }
  }
  return Decoration.set(out, true)
}

/** The link under `pos`: a [[wiki link]] or a [markdown](link). */
export function linkAt(state: EditorState, pos: number): { link: string; external: boolean } | null {
  const l = state.doc.lineAt(pos)
  const col = pos - l.from
  for (const m of l.text.matchAll(WIKI)) {
    if (col >= m.index && col <= m.index + m[0].length) return { link: m[2].trim(), external: false }
  }
  for (const m of l.text.matchAll(MD_LINK)) {
    if (col < m.index || col > m.index + m[0].length) continue
    let link = m[3]
    try { link = decodeURI(link) } catch { /* keep as written */ }
    return { link, external: EXTERNAL.test(link) }
  }
  return null
}

export type OpenLink = (link: string, external: boolean, newTab: boolean) => void

export function livePreview(openLink: OpenLink): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = livePreviewDecorations(view.state, view.visibleRanges, view.hasFocus)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = livePreviewDecorations(u.state, u.view.visibleRanges, u.view.hasFocus)
        }
      }
    },
    { decorations: (v) => v.decorations },
  )
  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      const tbl = e.button === 0 && (e.target as HTMLElement).closest?.('.cm-md-table')
      if (tbl) {
        e.preventDefault()
        view.dispatch({ selection: { anchor: view.posAtDOM(tbl) }, scrollIntoView: true })
        view.focus()
        return true
      }
      const box = (e.target as HTMLElement).closest?.('.task-list-item-checkbox')
      if (box && e.button === 0) {
        // toggle the `[ ]` / `[x]` at the start of this line in the text itself
        const l = view.state.doc.lineAt(view.posAtDOM(box))
        const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(l.text)
        if (!m) return false
        e.preventDefault()
        const at = l.from + m[1].length
        view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } })
        return true
      }
      const el = e.button === 0 && (e.target as HTMLElement).closest?.('.cm-hmd-internal-link, .cm-url-link')
      if (!el) return false
      const pos = view.posAtDOM(el)
      const mod = e.ctrlKey || e.metaKey
      const lineNo = view.state.doc.lineAt(pos).number
      const onActiveLine = view.state.selection.ranges.some((r) => view.state.doc.lineAt(r.head).number === lineNo)
      // on the line being edited a click places the cursor; Ctrl/⌘+click still follows the link
      if (onActiveLine && !mod) return false
      const hit = linkAt(view.state, pos)
      if (!hit) return false
      e.preventDefault()
      openLink(hit.link, hit.external, mod)
      return true
    },
  })
  return [plugin, tableField, clicks]
}
