/**
 * «Галактика»: the contract between the main-process builder (src/main/galaxy) and the renderer (src/app/galaxy).
 * Everything per star is in typed arrays indexed by star number `i` (0…count-1), so 10 000 notes cross IPC
 * as a handful of buffers.
 */

/** How the stars are arranged. */
export type GalaxyLayout = 'disk' | 'folders' | 'tags'

export interface GalaxyData {
  count: number
  /** vault path of star i; for a canvas card: `<canvas path>#<card id>` */
  paths: string[]
  /** what star i is: 0 = a note (.md), 1 = a text card on a canvas (no file of its own) */
  kind: Uint8Array
  /** note name (basename) of star i */
  names: string[]
  /** x,y,z per star (3·count) for each layout; world units, y is "up" (the disk lies in x/z) */
  positions: Record<GalaxyLayout, Float32Array>
  /** world radius of the sprite (grows with link count) */
  size: Float32Array
  /** 0…1: recent edits shine brighter */
  brightness: Float32Array
  /** r,g,b 0…1 per star (3·count): colour of its group (main tag / folder) */
  color: Float32Array
  /** links as pairs of star indices (2·edges), each undirected link once */
  edges: Uint32Array
  /** links per star (in + out, unique neighbours) */
  degree: Uint16Array
  /** modification time, ms since epoch */
  mtime: Float64Array
  /** names shown in the scene: the group centres (arms of the disk, folder / tag clusters) */
  labels: Record<GalaxyLayout, GalaxyLabel[]>
  /** how long building took and how many notes were re-read (the rest came from the cache) */
  stats: { ms: number; reparsed: number; cached: boolean }
}

export interface GalaxyLabel { text: string; x: number; y: number; z: number; color: string }
