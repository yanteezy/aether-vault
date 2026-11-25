/**
 * What the board draws on a large vault: only the notes near the screen. Building 10 000 cards took 17 s.
 * A small vault is drawn whole, exactly as before.
 */
import type { CanvasTransform } from '../hooks/useCanvasTransform'
import type { NoteCardData } from '../types/note'
import type { Size } from './geometry'

/** Up to this many notes nothing is culled. */
export const CULL_FROM = 300
/** More than this many on screen (zoomed far out): they are drawn as plain tiles with a title. */
export const MAX_CARDS = 300

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The part of the board to draw, in board coordinates: the screen plus a quarter screen on every side. */
export function viewRect(t: CanvasTransform, width: number, height: number): Rect {
  return {
    x0: (-width / 4 - t.x) / t.scale,
    y0: (-height / 4 - t.y) / t.scale,
    x1: (width * 1.25 - t.x) / t.scale,
    y1: (height * 1.25 - t.y) / t.scale,
  }
}

export const overlaps = (r: Rect, x0: number, y0: number, x1: number, y1: number) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0

/** The notes to draw, in board order. `pinned` ones (selected, edited, dragged) stay wherever they are. */
export function visibleNotes(notes: NoteCardData[], view: Rect, sizes: Map<string, Size>, pinned: Set<string>) {
  return notes.filter((n) => {
    const size = sizes.get(n.id)
    return pinned.has(n.id) || overlaps(view, n.x, n.y, n.x + (size?.width ?? n.width), n.y + (size?.height ?? n.height))
  })
}
