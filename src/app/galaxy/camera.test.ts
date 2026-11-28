// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { OrbitCamera } from './camera.js'
import { GalaxyRenderer } from './renderer.js'

const W = 900, H = 600, A = W / H

describe('OrbitCamera', () => {
  it('projects the target to the viewport centre', () => {
    const c = new OrbitCamera(); c.target = [10, 5, -20]
    const p = c.project(10, 5, -20, W, H)
    expect(p.x).toBeCloseTo(W / 2, 3); expect(p.y).toBeCloseTo(H / 2, 3); expect(p.visible).toBe(true)
  })
  it('zoomAt keeps the point under the cursor fixed; factor > 1 comes closer', () => {
    const c = new OrbitCamera(); c.pitch = 0.3; c.yaw = 1
    const [cy, sy, cp, sp] = [Math.cos(c.yaw), Math.sin(c.yaw), Math.cos(c.pitch), Math.sin(c.pitch)]
    // target + 40*right + 25*up
    const P: [number, number, number] = [cy * 40 - sy * sp * 25, cp * 25, -sy * 40 - cy * sp * 25]
    const a = c.project(...P, W, H)
    const d0 = c.distance
    c.zoomAt(2, a.x / W * 2 - 1, 1 - a.y / H * 2, A)
    const b = c.project(...P, W, H)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1)
    expect(c.distance).toBeCloseTo(d0 * 0.5)
  })
  it('preset reaches its end state', () => {
    const c = new OrbitCamera(); const t0 = performance.now()
    c.preset('edge', 500)
    expect(c.update(t0 + 10)).toBe(true)
    c.update(t0 + 600)
    expect(c.update(t0 + 700)).toBe(false)
    expect(c.pitch).toBeCloseTo(0.1); expect(c.yaw).toBeCloseTo(0.35)
  })
  it('flyTo reaches target and distance', () => {
    const c = new OrbitCamera()
    c.flyTo([1, 2, 3], 300, 500); c.update(performance.now() + 1000)
    expect(c.target).toEqual([1, 2, 3]); expect(c.distance).toBe(300)
  })
  it('reducedMotion jumps instantly', () => {
    const c = new OrbitCamera(); c.reducedMotion = true; c.autoRotate = true
    c.flyTo([1, 2, 3], 300); c.preset('top')
    expect(c.target).toEqual([1, 2, 3]); expect(c.distance).toBe(300); expect(c.pitch).toBeGreaterThan(1.5)
    expect(c.update(performance.now() + 5000)).toBe(false)
  })
  it('clamps pitch', () => {
    const c = new OrbitCamera(); c.orbit(0, 1e6)
    expect(c.pitch).toBeCloseTo(Math.PI / 2 - 0.05)
    c.orbit(0, -1e7)
    expect(c.pitch).toBeCloseTo(-(Math.PI / 2 - 0.05))
  })
})

describe('GalaxyRenderer', () => {
  it('reports ok=false without WebGL2 and does not throw', () => {
    const r = new GalaxyRenderer(document.createElement('canvas'))
    expect(r.ok).toBe(false)
    r.setStars(new Float32Array(3), new Float32Array(1), new Float32Array(1), new Float32Array(3))
    r.render(new OrbitCamera()); expect(r.pick(1, 1, new OrbitCamera())).toBe(-1); r.dispose()
  })
})
