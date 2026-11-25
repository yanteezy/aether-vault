/**
 * One note = one Markdown file with YAML frontmatter, readable by Obsidian.
 *
 * The file name is the title. Everything about the note itself lives in the file (frontmatter + text);
 * its position and size live in the `.canvas` file (see jsonCanvas.ts).
 * Rewriting a file keeps whatever Aether does not own: foreign frontmatter keys and comments.
 */
import { Document, isMap, parseDocument } from 'yaml'
import { resolveFontSize, type ChecklistItem, type NoteCardData, type NoteColor, type NoteStyle, type TitleAlign } from '../../types/note'
import type { NoteFont } from '../../settings/fonts'
import type { NoteImage } from '../images'
import type { NoteLink } from '../links'

/** A note without its place on the canvas. */
export type NoteContent = Omit<NoteCardData, 'x' | 'y' | 'width' | 'height'>

export interface SerializeOptions {
  /** File name (without `.md`) the note is saved under. */
  stem: string
  /** Extension of the note's photo file in `attachments/` (needed when the note has a photo). */
  imageExt?: string
  /** The current text of the file, when it already exists. */
  previous?: string
}

const COLORS: readonly NoteColor[] = ['default', 'accent', 'yellow', 'green', 'blue', 'pink', 'purple', 'gray']
const STYLES: readonly NoteStyle[] = ['plain', 'headline', 'caps', 'banner', 'quote', 'bullets']
const ALIGNS: readonly TitleAlign[] = ['left', 'center', 'right']

// ---------- frontmatter ----------
const FRONTMATTER = /^---\n(?:([\s\S]*?)\n)?---(?:\n|$)/

function split(text: string): { yaml: string; content: string } {
  // editors on Windows may save CRLF; a BOM may come first
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const m = FRONTMATTER.exec(t)
  return m ? { yaml: m[1] ?? '', content: t.slice(m[0].length) } : { yaml: '', content: t }
}

/** Throws `bad-frontmatter` rather than guessing: a file we can't read must never be rewritten. */
function readYaml(source: string) {
  const doc = parseDocument(source)
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) throw new Error('bad-frontmatter')
  return doc
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const oneOf = <T extends string>(list: readonly T[], v: unknown) => (list.includes(v as T) ? (v as T) : undefined)
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
const time = (v: unknown) => {
  const n = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(n) ? n : undefined
}
/** Keys a user may have for their own purposes: removed only when the old value is one Aether understands. */
const SHARED: Record<string, (v: unknown) => boolean> = {
  color: (v) => oneOf(COLORS, v) !== undefined,
  style: (v) => oneOf(STYLES, v) !== undefined,
  updated: (v) => time(v) !== undefined,
}

// ---------- body, checklist, code ----------
type Parts = Pick<NoteCardData, 'body' | 'code'> & { checklist?: Omit<ChecklistItem, 'id'>[] }

const TASK = /^- \[([ xX])\](?: (.*))?$/
const MARKER = /^%% aether:(body|checklist|code) %%$/
const ESCAPED = /^\\+%% aether:(body|checklist|code) %%$/
const escapeLine = (l: string) => (MARKER.test(l) || ESCAPED.test(l) ? '\\' + l : l)
const unescapeLine = (l: string) => (ESCAPED.test(l) ? l.slice(1) : l)

const taskLines = (list: NonNullable<Parts['checklist']>) =>
  list.map((i) => `- [${i.done ? 'x' : ' '}] ${i.label.replace(/\r?\n/g, ' ')}`)

function readTasks(lines: string[]): NonNullable<Parts['checklist']> | undefined {
  const out: NonNullable<Parts['checklist']> = []
  for (const line of lines) {
    const m = TASK.exec(line)
    if (!m) return undefined
    out.push({ label: m[2] ?? '', done: m[1] !== ' ' })
  }
  return out
}

function fenced(code: NonNullable<Parts['code']>) {
  // the fence is longer than any run of backticks inside the code
  const longest = Math.max(2, ...(code.content.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${code.language.replace(/[`\r\n]/g, '')}\n${code.content}\n${fence}`
}

/** The text is exactly one fenced code block. */
function readFence(text: string): Parts['code'] | undefined {
  const lines = text.split('\n')
  const open = /^(`{3,})([^`]*)$/.exec(lines[0])
  if (!open || lines.length < 2) return undefined
  const closes = (l: string) => l.startsWith(open[1]) && /^`+\s*$/.test(l)
  if (lines.findIndex((l, i) => i > 0 && closes(l)) !== lines.length - 1) return undefined
  return { language: open[2].trim(), content: lines.slice(1, -1).join('\n') }
}

/** Without markers: only tasks → checklist, only one code block → code, anything else → text. */
function readPlain(text: string): Parts {
  if (text === '') return {}
  const code = readFence(text)
  if (code) return { code }
  const checklist = readTasks(text.split('\n'))
  return checklist ? { checklist } : { body: text }
}

function readMarked(text: string): Parts {
  const lines = text.split('\n')
  const out: Parts = {}
  /** Lines that no longer fit their section (edited elsewhere) stay with the note's text. */
  const keep = (extra: string) => {
    out.body = out.body === undefined ? extra : `${out.body}\n${extra}`
  }
  let i = 0
  while (i < lines.length) {
    const kind = MARKER.exec(lines[i])![1]
    i++
    if (kind === 'code') {
      // always last: nothing inside it is a marker
      const rest = lines.slice(i).join('\n')
      const code = readFence(rest)
      if (code) out.code = code
      else keep(rest)
      break
    }
    const start = i
    while (i < lines.length && !MARKER.test(lines[i])) i++
    const section = lines.slice(start, i)
    if (kind === 'body') out.body = section.map(unescapeLine).join('\n')
    else {
      const list = readTasks(section)
      if (list) out.checklist = list
      else keep(section.join('\n'))
    }
  }
  return out
}

const readParts = (text: string) => (MARKER.test(text.split('\n', 1)[0]) ? readMarked(text) : readPlain(text))

const sameParts = (a: Parts, b: Parts) =>
  a.body === b.body &&
  JSON.stringify(a.checklist) === JSON.stringify(b.checklist) &&
  JSON.stringify(a.code) === JSON.stringify(b.code)

/** Markers (hidden comments in Obsidian) are added only when the plain text would be read back differently. */
function writeParts(parts: Parts): string {
  const list = parts.checklist ? taskLines(parts.checklist).join('\n') : undefined
  const code = parts.code ? fenced(parts.code) : undefined
  const plain = [parts.body, list, code].filter((s) => s !== undefined).join('\n\n')
  if (sameParts(readParts(plain), parts)) return plain
  const out: string[] = []
  if (parts.body !== undefined) out.push('%% aether:body %%', parts.body.split('\n').map(escapeLine).join('\n'))
  if (list !== undefined) out.push('%% aether:checklist %%', ...(list ? [list] : []))
  if (code !== undefined) out.push('%% aether:code %%', code)
  return out.join('\n')
}

// ---------- note → file ----------
export function serializeNote(note: NoteContent, { stem, imageExt, previous }: SerializeOptions): string {
  const before = previous === undefined ? '' : split(previous).yaml
  const doc = before.trim() ? readYaml(before) : new Document({})
  const old = (doc.toJS() ?? {}) as Record<string, unknown>

  const lead: string[] = []
  let image: Record<string, unknown> | undefined
  if (note.image) {
    if (!imageExt) throw new Error('image-ext-missing')
    image = { ...note.image }
    lead.push(`![[attachments/${note.image.id}.${imageExt}]]`)
  }
  let link: Record<string, unknown> | undefined
  if (note.link) {
    const { url, ...rest } = note.link
    link = rest
    lead.push(url)
  }
  const renamed = note.title !== stem
  const ours: Record<string, unknown> = {
    'aether-id': note.id,
    // the title when the file name can't hold it exactly; "title-file" tells a later rename in Obsidian apart
    'aether-title': renamed ? note.title : undefined,
    'aether-title-file': renamed ? stem : undefined,
    tags: note.tags.length ? note.tags : undefined,
    color: note.color,
    style: note.style,
    updated: note.updatedAt === undefined ? undefined : new Date(note.updatedAt).toISOString(),
    'aether-locked': note.locked,
    'aether-title-align': note.titleAlign,
    'aether-font-size': note.fontSize,
    'aether-font': note.font,
    'aether-image': image,
    'aether-kind': note.link ? 'link' : undefined,
    'aether-link': link,
    'aether-check-ids': note.checklist?.length ? note.checklist.map((i) => i.id) : undefined,
  }
  for (const [key, value] of Object.entries(ours)) {
    if (value !== undefined) {
      // an unchanged value keeps the user's own formatting of it
      if (JSON.stringify(old[key]) !== JSON.stringify(value)) doc.set(key, doc.createNode(value))
    } else if (doc.has(key) && (SHARED[key]?.(old[key]) ?? true)) doc.delete(key)
  }

  const content = [
    ...lead,
    writeParts({ body: note.body, checklist: note.checklist?.map(({ label, done }) => ({ label, done })), code: note.code }),
  ].join('\n')
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${content}\n`
}

// ---------- file → note ----------
/** `fallbackId` is used for files Aether did not create (no `aether-id`). */
export function parseNote(text: string, stem: string, fallbackId: string): NoteContent {
  const file = split(text)
  const fm = (file.yaml.trim() ? (readYaml(file.yaml).toJS() as Record<string, unknown> | null) : null) ?? {}
  const lines = file.content.replace(/\n$/, '').split('\n')

  let image: NoteImage | undefined
  const img = obj(fm['aether-image'])
  if (img && typeof img.id === 'string') {
    image = img as unknown as NoteImage
    if (lines[0]?.startsWith(`![[attachments/${img.id}.`)) lines.shift()
  }
  let link: NoteLink | undefined
  if (fm['aether-kind'] === 'link' && /^[a-z][a-z0-9+.-]*:\S+$/i.test(lines[0] ?? '')) {
    link = { kind: 'web', ...obj(fm['aether-link']), url: lines.shift()! }
  }
  const parts = readParts(lines.join('\n'))

  const title = str(fm['aether-title'])
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : (str(fm.tags)?.split(/[,\s]+/).filter(Boolean) ?? [])
  const ids = Array.isArray(fm['aether-check-ids']) ? fm['aether-check-ids'] : []

  const optional: Partial<NoteContent> = {
    body: parts.body,
    checklist: parts.checklist?.map((item, i) => ({ id: str(ids[i]) ?? `item-${i + 1}`, ...item })),
    code: parts.code,
    color: oneOf(COLORS, fm.color),
    style: oneOf(STYLES, fm.style),
    updatedAt: time(fm.updated),
    locked: typeof fm['aether-locked'] === 'boolean' ? fm['aether-locked'] : undefined,
    titleAlign: oneOf(ALIGNS, fm['aether-title-align']),
    fontSize: resolveFontSize(fm['aether-font-size']),
    font: str(fm['aether-font']) as NoteFont | undefined,
    image,
    link,
  }
  const note: NoteContent = {
    id: str(fm['aether-id']) || fallbackId,
    title: title !== undefined && fm['aether-title-file'] === stem ? title : stem,
    tags,
  }
  return Object.assign(note, Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)))
}
