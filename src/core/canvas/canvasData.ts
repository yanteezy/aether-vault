/**
 * JSON Canvas 1.0 (jsoncanvas.org, the `.canvas` format of Obsidian): parse, serialize, geometry.
 * Unknown fields on the file, nodes and edges are kept as they are, so other apps' data survives our saves.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type CanvasColor = string // '1'…'6' (presets) or '#rrggbb'

export interface CanvasNodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
  [key: string]: unknown
}
export interface TextNode extends CanvasNodeBase { type: 'text'; text: string }
export interface FileNode extends CanvasNodeBase { type: 'file'; file: string; subpath?: string }
export interface LinkNode extends CanvasNodeBase { type: 'link'; url: string }
export interface GroupNode extends CanvasNodeBase { type: 'group'; label?: string }
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: 'none' | 'arrow'
  toNode: string
  toSide?: Side
  toEnd?: 'none' | 'arrow'
  color?: CanvasColor
  label?: string
  [key: string]: unknown
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  [key: string]: unknown
}

/** Empty text is an empty canvas (a new file); anything else must be a JSON object. Throws on broken files. */
export function parseCanvas(text: string): CanvasData {
  if (!text.trim()) return { nodes: [], edges: [] }
  const data = JSON.parse(text.replace(/^﻿/, '')) // a byte-order mark (Windows Notepad) is not JSON
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Canvas file is not a JSON object')
  const nodes = Array.isArray(data.nodes) ? data.nodes : []
  const edges = Array.isArray(data.edges) ? data.edges : []
  for (const n of nodes) for (const k of ['x', 'y', 'width', 'height'] as const) n[k] = Number(n[k]) || 0
  const ids = new Set(nodes.map((n: CanvasNode) => n.id))
  return { ...data, nodes, edges: edges.filter((e: CanvasEdge) => ids.has(e.fromNode) && ids.has(e.toNode)) }
}

/** Tab-indented, like Obsidian writes it; positions rounded to whole pixels. */
export function serializeCanvas(data: CanvasData): string {
  for (const n of data.nodes) for (const k of ['x', 'y', 'width', 'height'] as const) n[k] = Math.round(n[k])
  return JSON.stringify(data, null, '\t')
}

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')

export interface Rect { x: number; y: number; width: number; height: number }

export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height

/** Nodes fully inside a group move with it. */
export const nodesInGroup = (data: CanvasData, group: GroupNode) => data.nodes.filter((n) => n !== group && contains(group, n))

export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
}

export function anchor(r: Rect, side: Side) {
  switch (side) {
    case 'top': return { x: r.x + r.width / 2, y: r.y }
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height }
    case 'left': return { x: r.x, y: r.y + r.height / 2 }
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 }
  }
}

/** An edge already joins these two sides of these two cards (either direction): a new one would lie on top of it. */
export function hasEdge(edges: CanvasEdge[], a: string, aSide: Side, b: string, bSide: Side) {
  return edges.some((e) =>
    (e.fromNode === a && e.fromSide === aSide && e.toNode === b && e.toSide === bSide) ||
    (e.fromNode === b && e.fromSide === bSide && e.toNode === a && e.toSide === aSide))
}

/**
 * Edges left after dropping the ones that repeat an earlier edge's path (same cards, same sides, either direction).
 * A repeat that carries a different label is kept, so no text is lost.
 */
export function withoutDuplicateEdges(edges: CanvasEdge[]): CanvasEdge[] {
  const kept = new Map<string, CanvasEdge>()
  return edges.filter((e) => {
    const ends = [`${e.fromNode}:${e.fromSide ?? ''}`, `${e.toNode}:${e.toSide ?? ''}`].sort().join('|')
    const first = kept.get(ends)
    if (!first) { kept.set(ends, e); return true }
    return !!e.label && e.label !== first.label
  })
}

/** The side of `from` that faces `to`, for edges saved without sides. */
export function facingSide(from: Rect, to: Rect): Side {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'
}

const NORMAL: Record<Side, { x: number; y: number }> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

/** SVG path of a curved edge leaving `fromSide` and entering `toSide`, plus its middle point for the label. */
export function edgePath(from: Rect, to: Rect, fromSide?: Side, toSide?: Side) {
  const fs = fromSide ?? facingSide(from, to)
  const ts = toSide ?? facingSide(to, from)
  const a = anchor(from, fs)
  const b = anchor(to, ts)
  const pull = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2.5)
  const c1 = { x: a.x + NORMAL[fs].x * pull, y: a.y + NORMAL[fs].y * pull }
  const c2 = { x: b.x + NORMAL[ts].x * pull, y: b.y + NORMAL[ts].y * pull }
  // point at t = 0.5 on the cubic Bézier
  const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 }
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid }
}

/** A freehand line. Not part of JSON Canvas: kept beside the file, see `canvasExtraPath`. Points are world coordinates. */
export interface Stroke {
  id: string
  points: [number, number][]
  color?: string
  width: number
  [key: string]: unknown
}

/** `<configDir>/canvas-extra/<canvas path, / → __>.json`: our data for a canvas that other apps must not see. */
export const canvasExtraPath = (configDir: string, canvasPath: string) => `${configDir}/canvas-extra/${canvasPath.replaceAll('/', '__')}.json`

export const strokePath = (points: [number, number][]) => `M ${points.map((p) => p.join(' ')).join(' L ')}`
