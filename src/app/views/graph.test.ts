import { describe, expect, it } from 'vitest'
import { forceLayout } from './graph.js'

describe('forceLayout', () => {
  it('pulls linked notes together and keeps every position finite', () => {
    // 0-1-2 linked in a chain, 3 and 4 alone
    const pos = forceLayout(5, [[0, 1], [1, 2]])
    const d = (a: number, b: number) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y)
    expect(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(d(0, 1)).toBeLessThan(d(0, 3))
    expect(d(1, 2)).toBeLessThan(d(3, 4))
  })
})

describe('forceLayout on a big vault', () => {
  it('uses the grid above 1,500 notes and still keeps linked notes closer', () => {
    const n = 2000
    const edges: [number, number][] = Array.from({ length: n / 2 }, (_, i) => [2 * i, 2 * i + 1])
    const t = Date.now()
    const pos = forceLayout(n, edges)
    expect(Date.now() - t).toBeLessThan(5000)
    expect(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    const avg = (pairs: [number, number][]) => pairs.reduce((s, [a, b]) => s + Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y), 0) / pairs.length
    const unlinked: [number, number][] = edges.map(([a]) => [a, (a + 2) % n])
    expect(avg(edges)).toBeLessThan(avg(unlinked))
  })
})
