import type { VaultIo } from '../features/vaultFiles'
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
