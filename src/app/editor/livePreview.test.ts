// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { linkAt, livePreviewDecorations, tableDecorations } from './livePreview.js'

const doc = ['---', 'tags: [a]', '---', '# Title', 'Some **bold** and [[Plan|the plan]] #idea', '`[[code]]`', ''].join('\n')

function decorations(cursor: number) {
  const state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const hidden: string[] = []
  const marks: [string, string][] = []
  const lines: string[] = []
  livePreviewDecorations(state).between(0, doc.length, (from, to, d) => {
    const spec = d.spec as { class?: string }
    if (from === to && spec.class) lines.push(`${state.doc.lineAt(from).number}:${spec.class}`)
    else if (spec.class) marks.push([state.sliceDoc(from, to), spec.class])
    else hidden.push(state.sliceDoc(from, to))
  })
  return { hidden, marks, lines, state }
}

describe('live preview', () => {
  it('hides marks on lines without the cursor and styles the text', () => {
    const { hidden, marks, lines } = decorations(doc.length) // cursor on the empty last line
    expect(hidden).toEqual(['# ', '**', '**', '[[Plan|', ']]', '`', '`'])
    expect(marks).toContainEqual(['**bold**', 'cm-strong'])
    expect(marks).toContainEqual(['the plan', 'cm-hmd-internal-link'])
    expect(marks).toContainEqual(['#idea', 'cm-hashtag'])
    expect(lines).toContain('4:HyperMD-header HyperMD-header-1')
    expect(lines).toContain('1:cm-hmd-frontmatter')
    expect(marks.some(([t, c]) => t.includes('code') && c.includes('internal-link'))).toBe(false) // nothing inside inline code is a link
  })

  it('shows the raw Markdown on the line being edited', () => {
    const { hidden } = decorations(doc.indexOf('bold'))
    expect(hidden).toEqual(['# ', '`', '`'])
  })

  it('draws bullets and task checkboxes off the line being edited; hides every mark when the editor is not focused', () => {
    const text = ['# Plan', '- one', '- [ ] todo', '- [x] done', '1. first', ''].join('\n')
    const state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [markdown({ base: markdownLanguage })] })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const widgets = (focused: boolean, s = state) => {
      const out: string[] = []
      livePreviewDecorations(s, undefined, focused).between(0, s.doc.length, (from, to, d) => {
        const w = (d.spec as { widget?: { constructor: { name: string }; checked?: boolean } }).widget
        if (w) out.push(`${s.sliceDoc(from, to)}=${w.constructor.name}${w.checked === undefined ? '' : `:${w.checked}`}`)
      })
      return out
    }
    expect(widgets(true)).toEqual(['-=Bullet', '- [ ]=Checkbox:false', '- [x]=Checkbox:true']) // ordered lists keep their numbers

    // cursor on the todo line: raw there while typing, drawn again once the editor loses focus
    const onTodo = state.update({ selection: { anchor: text.indexOf('todo') } }).state
    expect(widgets(true, onTodo)).toEqual(['-=Bullet', '- [x]=Checkbox:true'])
    expect(widgets(false, onTodo)).toEqual(['-=Bullet', '- [ ]=Checkbox:false', '- [x]=Checkbox:true'])
  })

  it('finds the link under the cursor', () => {
    const { state } = decorations(0)
    expect(linkAt(state, doc.indexOf('the plan'))).toEqual({ link: 'Plan', external: false })
    expect(linkAt(state, doc.indexOf('Some'))).toBeNull()
  })

  it('hides the quote mark off the active line only', () => {
    const text = ['> quoted', '', 'plain'].join('\n')
    const state = (anchor: number) => {
      const s = EditorState.create({ doc: text, selection: { anchor }, extensions: [markdown({ base: markdownLanguage })] })
      ensureSyntaxTree(s, s.doc.length, 5000)
      return s
    }
    const hidden = (s: EditorState) => {
      const out: string[] = []
      livePreviewDecorations(s).between(0, s.doc.length, (f, t, d) => { if (!(d.spec as { class?: string }).class) out.push(s.sliceDoc(f, t)) })
      return out
    }
    expect(hidden(state(text.length))).toEqual(['> '])
    expect(hidden(state(3))).toEqual([])
  })

  it('draws a table off the cursor as one block widget, raw when the cursor is inside', () => {
    const table = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')
    const text = `${table}\n\nafter`
    const state = (anchor: number) => {
      const s = EditorState.create({ doc: text, selection: { anchor }, extensions: [markdown({ base: markdownLanguage })] })
      ensureSyntaxTree(s, s.doc.length, 5000)
      return s
    }
    const widgets = (s: EditorState) => {
      const out: string[] = []
      tableDecorations(s).between(0, s.doc.length, (f, t, d) => { out.push(`${f}-${t}:${(d.spec as { widget?: object }).widget?.constructor.name}`) })
      return out
    }
    expect(widgets(state(text.length))).toEqual([`0-${table.length}:TableWidget`])
    expect(widgets(state(2))).toEqual([])
  })
})
