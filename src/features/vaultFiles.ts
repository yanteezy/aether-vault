/**
 * One vault folder as the app's data: reads a snapshot into `VaultData` and writes changes back,
 * one file per changed note. Not wired into the app yet (step 1b).
 *
 * Writing is a reconcile: `sync(data)` compares what should be on disk with what is known to be there and
 * does only the difference. The record of "what is there" moves forward after each successful call, so after
 * a failure the next `sync` carries on from the same place.
 */
import type { VaultData } from './vaultRepo'
import { fromCanvas, toCanvas, type CanvasExtra, type JsonCanvas } from './formats/jsonCanvas'
import { parseNote, serializeNote, type NoteContent } from './formats/noteMarkdown'
import type { NoteCardData } from '../types/note'
import type * as vaultFs from './vaultFs'
import type { VaultSnapshot } from './vaultFs'

export type VaultIo = Pick<typeof vaultFs, 'noteFileName' | 'writeNote' | 'renameNote' | 'deleteNote' | 'writeCanvas'>

const MD = /\.md$/i
const stemOf = (file: string) => file.replace(MD, '')
const NEW_W = 260
const NEW_H = 160

interface OnDisk {
  file: string
  text: string
  title: string
  /** The note object last written: React replaces changed objects, so the same object means no change. */
  note?: NoteCardData
  /** Its content without the position, to skip rewriting a note that was only moved. */
  content: string
}

const contentOf = (note: NoteCardData): NoteContent => {
  const { x: _x, y: _y, width: _w, height: _h, ...content } = note
  return content
}

export class VaultFiles {
  readonly dir: string
  /** Files that exist but could not be understood. They are never rewritten or deleted. */
  readonly problems: string[]
  private readonly io: VaultIo
  private readonly disk = new Map<string, OnDisk>()
  private readonly attachments: Map<string, string>
  private canvas: JsonCanvas | undefined
  private owned: string[] = []
  private board = ''
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(dir: string, io: VaultIo, snapshot: VaultSnapshot) {
    this.dir = dir
    this.io = io
    this.problems = [...snapshot.unreadable]
    this.attachments = new Map(snapshot.attachments.map((name) => [name.replace(/\.[^.]*$/, ''), name.split('.').pop()!]))
  }

  private get canvasFile() {
    return `${this.dir}.canvas`
  }

  static open(dir: string, snapshot: VaultSnapshot, io: VaultIo): { files: VaultFiles; data: VaultData } {
    const files = new VaultFiles(dir, io, snapshot)
    const contents: NoteContent[] = []
    const idByFile = new Map<string, string>()
    for (const { file, text } of snapshot.notes) {
      let note: NoteContent
      try {
        note = parseNote(text, stemOf(file), `file-${file}`)
      } catch {
        files.problems.push(file)
        continue
      }
      // a file copied in another app carries the same id: the copy becomes its own note
      if (files.disk.has(note.id)) note = { ...note, id: `${note.id}~${file}` }
      files.disk.set(note.id, { file, text, title: note.title, content: JSON.stringify(note) })
      idByFile.set(file, note.id)
      contents.push(note)
    }

    const raw = snapshot.canvases.find((c) => c.file === files.canvasFile)?.text
    // the same for the extra file: without it the next save would erase drawings and tag buttons
    const extraFile = `.aether/canvas-extra/${dir}.json`
    if (snapshot.unreadable.includes(extraFile)) throw new Error(`unreadable:${extraFile}`)
    let extra: CanvasExtra | undefined
    // a broken board file stops the whole vault: opening it as empty would overwrite it
    if (raw !== undefined) {
      files.canvas = JSON.parse(raw) as JsonCanvas
      const saved = snapshot.extras[files.dir]
      if (saved !== undefined) extra = JSON.parse(saved) as CanvasExtra
    } else if (snapshot.unreadable.includes(files.canvasFile)) throw new Error(`unreadable:${files.canvasFile}`)
    const board = fromCanvas(files.canvas ?? { nodes: [], edges: [] }, extra, (f) => idByFile.get(f))
    files.owned = board.owned ?? []

    const places = new Map(board.places.map((p) => [p.id, p]))
    // notes the board doesn't show yet (made in another app) line up under everything else
    let row = 0
    const bottom = Math.max(0, ...board.places.map((p) => p.y + p.height), ...board.frames.map((f) => f.y + f.height))
    const notes = contents.map((content): NoteCardData => {
      const place = places.get(content.id) ?? {
        x: (row % 5) * (NEW_W + 40),
        y: bottom + 80 + Math.floor(row++ / 5) * (NEW_H + 40),
        width: NEW_W,
        height: NEW_H,
      }
      return { ...content, x: place.x, y: place.y, width: place.width, height: place.height }
    })
    // the board's order is the drawing order
    const order = new Map(board.places.map((p, i) => [p.id, i]))
    notes.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
    for (const note of notes) files.disk.get(note.id)!.note = note

    const data: VaultData = {
      notes,
      connections: board.connections,
      frames: board.frames,
      chips: board.chips,
      ink: board.ink,
      'canvas-transform': board.view ?? { x: 0, y: 0, scale: 1 },
    }
    // opening writes nothing: the current state counts as saved
    if (raw !== undefined) files.board = files.render(data).signature
    return { files, data }
  }

  /** Bring the folder up to date. Calls run one after another. */
  sync(data: VaultData): Promise<void> {
    const run = this.queue.then(() => this.reconcile(data))
    this.queue = run.catch(() => {})
    return run
  }

  private render(data: VaultData) {
    const colors = new Map(data.notes.map((n) => [n.id, n.color]))
    const out = toCanvas(
      {
        places: data.notes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
        connections: data.connections,
        frames: data.frames,
        ink: data.ink,
        chips: data.chips,
        view: data['canvas-transform'],
        owned: this.owned,
      },
      { fileOf: (id) => this.disk.get(id)!.file, colorOf: (id) => colors.get(id), previous: this.canvas },
    )
    const canvas = JSON.stringify(out.canvas, null, 2) + '\n'
    const extra = JSON.stringify(out.extra, null, 2) + '\n'
    return { ...out, text: canvas, extraText: extra, signature: canvas + extra }
  }

  private async reconcile(data: VaultData) {
    for (const note of data.notes) await this.saveNote(note)

    const alive = new Set(data.notes.map((n) => n.id))
    for (const [id, entry] of this.disk) {
      if (alive.has(id)) continue
      await this.io.deleteNote(this.dir, entry.file)
      this.disk.delete(id)
    }

    // the board comes last: it points at the note files
    const next = this.render(data)
    if (next.signature === this.board) return
    await this.io.writeCanvas(this.dir, this.canvasFile, next.text, next.extraText)
    this.board = next.signature
    this.canvas = next.canvas
    this.owned = next.owned
  }

  private async saveNote(note: NoteCardData) {
    const entry = this.disk.get(note.id)
    if (entry?.note === note) return
    const content = contentOf(note)
    const signature = JSON.stringify(content)
    if (entry && sameContent(entry.content, content)) {
      entry.note = note
      return
    }
    let file = entry?.file
    if (entry && entry.title !== note.title) {
      file = await this.io.renameNote(this.dir, entry.file, note.title)
      // remembered at once: if the write below fails, the retry must find the renamed file
      entry.file = file
      entry.title = note.title
      entry.content = ''
    }
    const isNew = file === undefined
    file ??= await this.io.noteFileName(this.dir, note.title)
    const text = serializeNote(content, {
      stem: stemOf(file),
      imageExt: note.image ? (this.attachments.get(note.image.id) ?? 'jpg') : undefined,
      previous: entry?.text,
    })
    await this.io.writeNote(this.dir, file, text, isNew)
    this.disk.set(note.id, { file, text, title: note.title, note, content: signature })
  }

  hasAttachment(id: string) {
    return this.attachments.has(id)
  }

  /** A photo added after opening: its extension is needed to link it from the note. */
  attachmentAdded(name: string) {
    const dot = name.lastIndexOf('.')
    this.attachments.set(name.slice(0, dot), name.slice(dot + 1))
  }
}

/** Key order differs between a parsed note and the app's own object. */
function sameContent(saved: string, content: NoteContent) {
  return saved !== '' && stable(JSON.parse(saved)) === stable(JSON.parse(JSON.stringify(content)))
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  )
}
