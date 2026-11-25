/**
 * A vault's board = one `.canvas` file (JSON Canvas 1.0, https://jsoncanvas.org) + Aether's extra file
 * (`.aether/canvas-extra/<name>.json`) for what the format has no place for: drawings, tag buttons,
 * frame colours and locks, the view.
 *
 * The `.canvas` file holds only standard fields. Whatever someone added in another app (text cards, web
 * cards, extra arrows, edge labels) is kept when Aether rewrites the file.
 */
import type { CanvasTransform } from '../../hooks/useCanvasTransform'
import type { Connection, Frame, FrameColor, InkStroke, NoteColor, Side, TagChip } from '../../types/note'

export interface CanvasNode {
  id: string
  type: 'file' | 'text' | 'link' | 'group'
  x: number
  y: number
  width: number
  height: number
  color?: string
  file?: string
  label?: string
  [other: string]: unknown
}
export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: Side
  toSide?: Side
  [other: string]: unknown
}
export interface JsonCanvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface CanvasExtra {
  version: 1
  frames: Record<string, { color: FrameColor; locked?: boolean }>
  ink: InkStroke[]
  chips: TagChip[]
  view?: CanvasTransform
}

export interface NotePlace {
  id: string
  x: number
  y: number
  width: number
  height: number
}
export interface Board {
  /** Where each note stands, in drawing order. */
  places: NotePlace[]
  connections: Connection[]
  frames: Frame[]
  ink: InkStroke[]
  chips: TagChip[]
  view?: CanvasTransform
  /**
   * Ids of the cards, frames and arrows in the file that Aether has actually loaded or written. Only these may
   * disappear from the file on the next write; everything else (another app's content, a card whose note file
   * has not arrived yet) is kept.
   */
  owned?: string[]
}

// JSON Canvas presets: 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple
const NOTE_COLOR: Partial<Record<NoteColor, string>> = { pink: '1', yellow: '3', green: '4', blue: '5', purple: '6' }
const FRAME_COLOR: Partial<Record<FrameColor, string>> = { pink: '1', amber: '2', mint: '4', cyan: '5', lavender: '6' }
const FRAME_FROM: Record<string, FrameColor> = { '1': 'pink', '2': 'amber', '3': 'amber', '4': 'mint', '5': 'cyan', '6': 'lavender' }

/** JSON Canvas allows only whole pixels. */
const box = (o: { x: number; y: number; width: number; height: number }) => ({
  x: Math.round(o.x),
  y: Math.round(o.y),
  width: Math.round(o.width),
  height: Math.round(o.height),
})

/** No colour means no `color` key at all. */
const withColor = (node: CanvasNode, color: string | undefined): CanvasNode => {
  if (color) node.color = color
  else delete node.color
  return node
}

export interface WriteOptions {
  /** The note's file path inside the vault, e.g. `Моя нотатка.md`. */
  fileOf: (noteId: string) => string
  colorOf?: (noteId: string) => NoteColor | undefined
  /** What the `.canvas` file holds now, when it exists. */
  previous?: JsonCanvas
}

/** `owned` is what the board must carry into its next write. */
export function toCanvas(
  board: Board,
  { fileOf, colorOf, previous }: WriteOptions,
): { canvas: JsonCanvas; extra: CanvasExtra; owned: string[] } {
  const oldNodes = new Map(previous?.nodes?.map((n) => [n.id, n]))
  const oldEdges = new Map(previous?.edges?.map((e) => [e.id, e]))

  const groups = board.frames.map((f) =>
    withColor({ ...oldNodes.get(f.id), id: f.id, type: 'group', ...box(f), label: f.title }, FRAME_COLOR[f.color]),
  )
  /** note id → node id: a card added in another app has its own id, which stays */
  const cardOf = new Map<string, string>()
  const files = board.places.map((p) => {
    const file = fileOf(p.id)
    const old = oldNodes.get(p.id) ?? previous?.nodes?.find((n) => n.type === 'file' && n.file === file)
    const id = old?.id ?? p.id
    cardOf.set(p.id, id)
    const color = colorOf?.(p.id)
    return withColor({ ...old, id, type: 'file', ...box(p), file }, color && NOTE_COLOR[color])
  })
  const edges = board.connections.map((c) => {
    const edge: CanvasEdge = {
      ...oldEdges.get(c.id),
      id: c.id,
      fromNode: cardOf.get(c.from) ?? c.from,
      toNode: cardOf.get(c.to) ?? c.to,
    }
    for (const side of ['fromSide', 'toSide'] as const) {
      if (c[side]) edge[side] = c[side]
      else delete edge[side]
    }
    return edge
  })

  const ids = new Set([...groups, ...files, ...edges].map((o) => o.id))
  const ours = new Set(board.owned)
  const keep = (o: { id: string }) => !ids.has(o.id) && !ours.has(o.id)
  const foreignNodes = previous?.nodes?.filter(keep) ?? []
  const nodeIds = new Set([...groups, ...files, ...foreignNodes].map((n) => n.id))
  const foreignEdges = previous?.edges?.filter((e) => keep(e) && nodeIds.has(e.fromNode) && nodeIds.has(e.toNode)) ?? []

  return {
    canvas: { nodes: [...groups, ...files, ...foreignNodes], edges: [...edges, ...foreignEdges] },
    extra: {
      version: 1,
      frames: Object.fromEntries(
        board.frames.map((f) => [f.id, { color: f.color, ...(f.locked === undefined ? {} : { locked: f.locked }) }]),
      ),
      ink: board.ink,
      chips: board.chips,
      ...(board.view ? { view: board.view } : {}),
    },
    owned: [...ids],
  }
}

/** `idOf` returns the note stored in a file, or undefined when the file is not a note of this vault. */
export function fromCanvas(canvas: JsonCanvas, extra: CanvasExtra | undefined, idOf: (file: string) => string | undefined): Board {
  /** node id → note id, for the arrows */
  const cards = new Map<string, string>()
  const places: NotePlace[] = []
  const frames: Frame[] = []
  const placed = new Set<string>()

  for (const n of canvas.nodes ?? []) {
    if (n.type === 'group') {
      const saved = extra?.frames[n.id]
      // the colour from the extra file wins unless it was changed in another app
      const color = saved && FRAME_COLOR[saved.color] === n.color ? saved.color : (n.color && FRAME_FROM[n.color]) || 'default'
      frames.push({
        id: n.id,
        title: n.label ?? '',
        ...box(n),
        color,
        ...(saved?.locked === undefined ? {} : { locked: saved.locked }),
      })
    } else if (n.type === 'file' && n.file) {
      const id = idOf(n.file)
      // a second card of the same note stays in the file but is not shown: Aether has one place per note
      if (!id || placed.has(id)) continue
      placed.add(id)
      cards.set(n.id, id)
      places.push({ id, ...box(n) })
    }
  }

  const connections: Connection[] = []
  for (const e of canvas.edges ?? []) {
    const from = cards.get(e.fromNode)
    const to = cards.get(e.toNode)
    if (!from || !to) continue
    connections.push({
      id: e.id,
      from,
      to,
      ...(e.fromSide ? { fromSide: e.fromSide } : {}),
      ...(e.toSide ? { toSide: e.toSide } : {}),
    })
  }

  return {
    places,
    connections,
    frames,
    ink: extra?.ink ?? [],
    chips: extra?.chips ?? [],
    ...(extra?.view ? { view: extra.view } : {}),
    owned: [...frames.map((f) => f.id), ...cards.keys(), ...connections.map((c) => c.id)],
  }
}
