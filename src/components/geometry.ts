import type { NoteCardData, Side } from '../types/note'

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export function anchorPoint(note: NoteCardData, size: Size | undefined, side: Side): Point {
  const w = size?.width ?? note.width
  const h = size?.height ?? note.height
  switch (side) {
    case 'top':
      return { x: note.x + w / 2, y: note.y }
    case 'bottom':
      return { x: note.x + w / 2, y: note.y + h }
    case 'left':
      return { x: note.x, y: note.y + h / 2 }
    case 'right':
      return { x: note.x + w, y: note.y + h / 2 }
  }
}

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** Cubic bezier leaving `a` along side `sa`, entering `b` along side `sb` (or free end). */
export function bezier(a: Point, sa: Side, b: Point, sb?: Side) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.max(50, dist * 0.4)
  const n1 = NORMAL[sa]
  const c1 = { x: a.x + n1.x * k, y: a.y + n1.y * k }
  let c2: Point
  if (sb) {
    const n2 = NORMAL[sb]
    c2 = { x: b.x + n2.x * k, y: b.y + n2.y * k }
  } else {
    c2 = { x: b.x - n1.x * k * 0.3, y: b.y - n1.y * k * 0.3 }
  }
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
}

/** Side of `note` closest to world point `p`. */
export function nearestSide(note: NoteCardData, size: Size | undefined, p: Point): Side {
  const sides: Side[] = ['top', 'right', 'bottom', 'left']
  let best: Side = 'left'
  let bestD = Infinity
  for (const s of sides) {
    const a = anchorPoint(note, size, s)
    const d = Math.hypot(a.x - p.x, a.y - p.y)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

export const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

/** Detective theme: where the push-pin sits (top centre of the card). */
export const PIN_OFFSET = 14
export function pinPoint(note: NoteCardData, size: Size | undefined): Point {
  const w = size?.width ?? note.width
  return { x: note.x + w / 2, y: note.y + PIN_OFFSET }
}

/** A string hanging between two pins: gravity sag grows with distance. */
export function sagString(a: Point, b: Point) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const sag = Math.min(90, 12 + dist * 0.12)
  const cx = (a.x + b.x) / 2
  const cy = Math.max(a.y, b.y) + sag
  return `M ${a.x} ${a.y} Q ${cx} ${cy}, ${b.x} ${b.y}`
}
