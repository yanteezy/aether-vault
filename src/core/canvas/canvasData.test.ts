import { describe, expect, it } from 'vitest'
import { bounds, edgePath, facingSide, hasEdge, nodesInGroup, withoutDuplicateEdges, parseCanvas, serializeCanvas, type GroupNode } from './canvasData.js'

describe('JSON Canvas', () => {
  it('reads an empty file as an empty canvas and rejects broken JSON', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] })
    expect(() => parseCanvas('{ nodes: ')).toThrow()
    expect(() => parseCanvas('[]')).toThrow('not a JSON object')
    expect(parseCanvas('﻿{"nodes":[],"edges":[]}')).toEqual({ nodes: [], edges: [] }) // saved by Notepad, with a BOM
  })

  it('keeps fields it does not know, drops edges to missing nodes, writes tabs and whole pixels', () => {
    const text = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', text: 'Hi', x: 0.4, y: 10, width: 100, height: 50, styleAttributes: { shape: 'pill' } }],
      edges: [{ id: 'e1', fromNode: 'a', toNode: 'gone' }],
      metadata: { version: '1.0-1.0' },
    })
    const data = parseCanvas(text)
    expect(data.edges).toEqual([])
    const out = serializeCanvas(data)
    expect(out).toContain('\t"metadata"')
    expect(JSON.parse(out).nodes[0]).toEqual({ id: 'a', type: 'text', text: 'Hi', x: 0, y: 10, width: 100, height: 50, styleAttributes: { shape: 'pill' } })
  })

  it('geometry: groups, bounds, sides, curves', () => {
    const group: GroupNode = { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500 }
    const inside = { id: 'i', type: 'text' as const, text: '', x: 10, y: 10, width: 100, height: 100 }
    const half = { id: 'h', type: 'text' as const, text: '', x: 450, y: 10, width: 100, height: 100 }
    expect(nodesInGroup({ nodes: [group, inside, half], edges: [] }, group)).toEqual([inside])
    expect(bounds([inside, half])).toEqual({ x: 10, y: 10, width: 540, height: 100 })
    expect(facingSide(inside, half)).toBe('right')
    expect(facingSide(half, inside)).toBe('left')
    const { d, mid } = edgePath(inside, { ...half, x: 300 })
    expect(d.startsWith('M 110 60 C')).toBe(true) // leaves the right side's middle
    expect(mid.y).toBe(60)
  })

  it('knows when an edge already joins the same two sides, in either direction', () => {
    const edges = [{ id: 'e', fromNode: 'a', fromSide: 'bottom' as const, toNode: 'b', toSide: 'top' as const }]
    expect(hasEdge(edges, 'a', 'bottom', 'b', 'top')).toBe(true)
    expect(hasEdge(edges, 'b', 'top', 'a', 'bottom')).toBe(true) // the same path drawn back
    expect(hasEdge(edges, 'a', 'right', 'b', 'top')).toBe(false) // another side: another path
    expect(hasEdge(edges, 'a', 'bottom', 'c', 'top')).toBe(false)
  })

  it('drops edges that repeat a path, in either direction, but keeps a repeat with its own label', () => {
    const e = (id: string, from: string, fs: 'top' | 'bottom' | 'left' | 'right', to: string, ts: 'top' | 'bottom' | 'left' | 'right', label?: string) =>
      ({ id, fromNode: from, fromSide: fs, toNode: to, toSide: ts, ...(label ? { label } : {}) })
    const edges = [
      e('1', 'a', 'bottom', 'b', 'top', 'plan'),
      e('2', 'a', 'bottom', 'b', 'top'), // plain repeat
      e('3', 'b', 'top', 'a', 'bottom', 'plan'), // drawn back, same label
      e('4', 'a', 'bottom', 'b', 'top', 'other'), // its own text: kept
      e('5', 'a', 'right', 'b', 'left'), // another path
    ]
    expect(withoutDuplicateEdges(edges).map((x) => x.id)).toEqual(['1', '4', '5'])
  })
})
