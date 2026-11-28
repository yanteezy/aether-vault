/**
 * Markdown text → `CachedMetadata` (shapes as in obsidian.d.ts).
 * shortcut: line-based, no full Markdown parser; no listItems, blocks (^id), callouts or tables yet. Upgrade with the editor (step 3).
 */
import { parse as parseYaml } from 'yaml'

export interface Loc { line: number; col: number; offset: number }
export interface Pos { start: Loc; end: Loc }
export interface LinkCache { link: string; original: string; displayText?: string; position: Pos }
export type EmbedCache = LinkCache
export interface TagCache { tag: string; position: Pos }
export interface HeadingCache { heading: string; level: number; position: Pos }
export interface SectionCache { type: string; position: Pos }
export interface CachedMetadata {
  links?: LinkCache[]
  embeds?: EmbedCache[]
  tags?: TagCache[]
  headings?: HeadingCache[]
  sections?: SectionCache[]
  frontmatter?: Record<string, any>
  frontmatterPosition?: Pos
}

export const WIKI = /(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
export const MD_LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g
export const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu
const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^\s*(```|~~~)/

export function parseMarkdown(text: string): CachedMetadata {
  const lines = text.split('\n')
  const starts: number[] = []
  let o = 0
  for (const l of lines) { starts.push(o); o += l.length + 1 }
  const loc = (line: number, col: number): Loc => ({ line, col, offset: starts[line] + col })
  const pos = (line: number, a: number, b: number): Pos => ({ start: loc(line, a), end: loc(line, b) })
  const lineEnd = (line: number) => loc(line, lines[line].length)

  const meta: CachedMetadata = {}
  const push = <K extends keyof CachedMetadata>(key: K, item: NonNullable<CachedMetadata[K]> extends (infer T)[] ? T : never) =>
    ((meta[key] ??= [] as any) as any[]).push(item)

  let i = 0
  // frontmatter: only at the very top, closed by a `---` line
  if (lines[0]?.trimEnd() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && l.trimEnd() === '---')
    if (close > 0) {
      const position = { start: loc(0, 0), end: lineEnd(close) }
      try {
        const fm = parseYaml(lines.slice(1, close).join('\n'))
        if (fm && typeof fm === 'object') meta.frontmatter = fm
      } catch { /* broken YAML: no frontmatter, the text stays untouched */ }
      meta.frontmatterPosition = position
      push('sections', { type: 'yaml', position })
      i = close + 1
    }
  }

  let section: SectionCache | undefined
  const close = (line: number) => { if (section) { section.position.end = lineEnd(line); section = undefined } }
  const open = (type: string, line: number) => { section = { type, position: { start: loc(line, 0), end: lineEnd(line) } }; push('sections', section) }

  for (; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) {
      close(i - 1)
      open('code', i)
      const fence = line.trim().slice(0, 3)
      while (++i < lines.length && !lines[i].trim().startsWith(fence));
      close(Math.min(i, lines.length - 1))
      continue
    }
    if (!line.trim()) { close(i - 1); continue }

    const h = HEADING.exec(line)
    if (h) {
      close(i - 1)
      push('headings', { heading: h[2], level: h[1].length, position: pos(i, 0, line.length) })
      open('heading', i)
      close(i)
      continue
    }
    if (!section) open(/^\s*([-*+]|\d+[.)])\s/.test(line) ? 'list' : line.startsWith('>') ? 'blockquote' : 'paragraph', i)
    else section.position.end = lineEnd(i)

    const plain = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)) // ignore inline code, keep columns
    for (const m of plain.matchAll(WIKI)) {
      const link = m[2].trim()
      push(m[1] ? 'embeds' : 'links', { link, original: m[0], displayText: m[3] ?? link, position: pos(i, m.index, m.index + m[0].length) })
    }
    for (const m of plain.matchAll(MD_LINK)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[3])) continue // external URL, not a note
      let link = m[3]
      try { link = decodeURI(link) } catch { /* keep as written */ }
      push(m[1] ? 'embeds' : 'links', { link, original: m[0], displayText: m[2], position: pos(i, m.index, m.index + m[0].length) })
    }
    for (const m of plain.matchAll(TAG)) {
      if (/^\d+$/.test(m[2])) continue // "#123" is not a tag
      const at = m.index + m[1].length
      push('tags', { tag: `#${m[2]}`, position: pos(i, at, at + m[2].length + 1) })
    }
  }
  close(lines.length - 1)
  return meta
}
