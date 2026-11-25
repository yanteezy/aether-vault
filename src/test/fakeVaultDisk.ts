import type { VaultIo } from '../features/vaultFiles'
import type { FileIo } from '../features/fileStore'
import type { VaultSnapshot } from '../features/vaultFs'

/** A vault folder in memory that behaves like the Rust side: names ignore case, nothing is replaced. */
export function fakeDisk() {
  const notes = new Map<string, string>()
  const trash: string[] = []
  const boards = new Map<string, { canvas: string; extra: string }>()
  const log: string[] = []
  let failing: string | undefined
  const step = (op: string, file: string) => {
    if (failing === op) throw new Error('disk full')
    log.push(`${op} ${file}`)
  }
  const free = (title: string, own?: string) => {
    const taken = new Set([...notes.keys()].filter((f) => f !== own).map((f) => f.toLowerCase()))
    const stem = title.replace(/[/\\?:]/g, '-') || 'Без назви'
    let file = `${stem}.md`
    for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${stem} ${n}.md`
    return file
  }
  const io: VaultIo = {
    noteFileName: async (_v, title, current) => free(title, current),
    writeNote: async (_v, file, text, create) => {
      step('write', file)
      if (create && notes.has(file)) throw new Error('exists')
      notes.set(file, text)
    },
    renameNote: async (_v, file, title) => {
      step('rename', file)
      const to = free(title, file)
      const text = notes.get(file)!
      notes.delete(file)
      notes.set(to, text)
      return to
    },
    deleteNote: async (_v, file) => {
      step('delete', file)
      if (notes.delete(file)) trash.push(file)
    },
    writeCanvas: async (_v, file, canvas, extra) => {
      step('canvas', file)
      boards.set(file, { canvas, extra })
    },
  }
  const snapshot = (): VaultSnapshot => ({
    meta: '{}',
    notes: [...notes].map(([file, text]) => ({ file, text })),
    canvases: [...boards].map(([file, b]) => ({ file, text: b.canvas })),
    extras: Object.fromEntries([...boards].map(([file, b]) => [file.replace('.canvas', ''), b.extra])),
    attachments: ['img-1.png'],
    unreadable: [],
  })
  return { io, notes, trash, boards, log, snapshot, fail: (op?: string) => (failing = op) }
}

/** Several vault folders, each an in-memory disk. */
export function fakeLibrary() {
  const folders = new Map<string, { meta: string; disk: ReturnType<typeof fakeDisk>; attachments: Set<string> }>()
  const at = (dir: string) => folders.get(dir)!
  let corrupt = false
  const trashed: string[] = []
  const io: FileIo = {
    listVaults: async () => [...folders].map(([dir, f]) => ({ dir, meta: f.meta })),
    writeVaultMeta: async (dir, name, meta) => {
      let target = dir
      if (!target) {
        target = name
        for (let n = 2; folders.has(target); n++) target = `${name} ${n}`
        folders.set(target, { meta, disk: fakeDisk(), attachments: new Set() })
      }
      at(target).meta = meta
      return target
    },
    readVault: async (dir) => ({ ...at(dir).disk.snapshot(), meta: at(dir).meta, attachments: [...at(dir).attachments] }),
    writeAttachment: async (dir, name) => void at(dir).attachments.add(name),
    deleteVault: async (dir) => {
      trashed.push(dir)
      folders.delete(dir)
    },
    noteFileName: (v, ...a) => at(v).disk.io.noteFileName(v, ...a),
    writeNote: (v, file, text, create) => at(v).disk.io.writeNote(v, file, corrupt ? text.slice(0, -3) : text, create),
    renameNote: (v, ...a) => at(v).disk.io.renameNote(v, ...a),
    deleteNote: (v, ...a) => at(v).disk.io.deleteNote(v, ...a),
    writeCanvas: (v, ...a) => at(v).disk.io.writeCanvas(v, ...a),
  }
  return { io, folders, at, trashed, corrupt: (on: boolean) => (corrupt = on) }
}
