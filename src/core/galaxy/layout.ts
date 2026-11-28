/**
 * Where a note sits in the Galaxy — a pure function of the note itself (its path and its group),
 * so the layout is the same on every start and only changed notes need new coordinates.
 * No Math.random: every "random" number comes from a hash of the path.
 */
import type { GalaxyLayout } from './types.js'

export const ARMS = 3
const DISK_R = 400
const CLUSTER_R = 330

/** FNV-1a 32-bit: a stable hash of a string (salted). */
export function hash32(s: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // final avalanche, so near-identical paths spread out
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16
  return h >>> 0
}
/** A stable number in [0, 1) for this string and salt. */
export const rnd = (s: string, salt: number) => hash32(s, salt) / 4294967296
/** A stable, roughly normal number in about [-1.5, 1.5]. */
const gauss = (s: string, salt: number) => rnd(s, salt) + rnd(s, salt + 101) + rnd(s, salt + 202) - 1.5

/** The groups a note belongs to: its main tag (first tag) and its top folder. */
export interface NoteGroups { tag: string; folder: string }
export function groupsOf(path: string, tags: string[]): NoteGroups {
  const slash = path.indexOf('/')
  return { tag: tags[0]?.toLowerCase() ?? '', folder: slash > 0 ? path.slice(0, slash) : '' }
}

/** Spiral disk: three arms; the arm comes from the main tag (else the folder), the place along it from the path. */
export function diskPosition(path: string, g: NoteGroups): [number, number, number] {
  const key = g.tag || g.folder || path
  const arm = hash32(key, 7) % ARMS
  const t = Math.pow(rnd(path, 1), 0.8)
  const rad = 20 + t * (DISK_R - 20)
  const a = arm * (2 * Math.PI / ARMS) + t * 3.4 + (rnd(path, 2) - 0.5) * 0.7 * (1 - 0.5 * t)
  let y = gauss(path, 3) * (26 * (1 - t) + 8)
  if (rad < 90) y += (rnd(path, 4) - 0.5) * (90 - rad) * 1.2 // a thicker bulge in the middle
  return [Math.cos(a) * rad, y, Math.sin(a) * rad]
}

/** The centre of a cluster on a sphere: golden-angle spiral position picked by the hash of the group name. */
export function clusterCentre(key: string): [number, number, number] {
  if (!key) return [0, 0, 0] // notes with no folder / no tag gather in the middle
  const u = rnd(key, 11) * 2 - 1 // cos of the polar angle, uniform on the sphere
  const phi = rnd(key, 12) * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return [Math.cos(phi) * s * CLUSTER_R, u * CLUSTER_R * 0.55, Math.sin(phi) * s * CLUSTER_R]
}

/** A cluster (nebula) per group: the note sits around its group's centre. */
export function clusterPosition(path: string, key: string): [number, number, number] {
  const [cx, cy, cz] = clusterCentre(key)
  return [cx + gauss(path, 21) * 110, cy + gauss(path, 22) * 80, cz + gauss(path, 23) * 110]
}

export function positionFor(layout: GalaxyLayout, path: string, g: NoteGroups): [number, number, number] {
  if (layout === 'disk') return diskPosition(path, g)
  return clusterPosition(path, layout === 'folders' ? g.folder : g.tag)
}

/** Star colours: the palette of the mockups plus the canvas colours; white stars are sprinkled in. */
const PALETTE = ['#7fc1ff', '#b9a2ff', '#ff8fbf', '#51cf66', '#ffd43b', '#ffa94d', '#4dabf7']
export function groupColor(key: string): string {
  return key ? PALETTE[hash32(key, 31) % PALETTE.length] : '#c9d6ff'
}
export function starColor(path: string, g: NoteGroups): [number, number, number] {
  const hex = rnd(path, 41) < 0.22 ? '#ffffff' : groupColor(g.tag || g.folder)
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]
}

/** World radius: well-linked notes are bigger stars. */
export const starSize = (degree: number) => 0.9 + Math.log2(1 + degree) * 0.9
/** 0…1: notes edited recently shine brighter (half-life about two months). */
export const starBrightness = (mtime: number, now: number) => 0.4 + 0.6 * Math.exp(-Math.max(0, now - mtime) / (60 * 86_400_000))
