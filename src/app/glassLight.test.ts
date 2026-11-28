// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installGlassLight, lightIntensity, rectDistance } from './glassLight.js'

describe('glassLight math', () => {
  it('intensity is 1 at the pointer, 0 at and beyond the radius, monotonic between', () => {
    expect(lightIntensity(0, 100)).toBe(1)
    expect(lightIntensity(100, 100)).toBe(0)
    expect(lightIntensity(250, 100)).toBe(0)
    let prev = 1
    for (let d = 5; d < 100; d += 5) { const i = lightIntensity(d, 100); expect(i).toBeLessThan(prev); prev = i }
  })
  it('rect distance is 0 inside and euclidean outside', () => {
    const r = { left: 10, top: 10, right: 50, bottom: 30 }
    expect(rectDistance(20, 20, r)).toBe(0)
    expect(rectDistance(60, 20, r)).toBe(10)
    expect(rectDistance(53, 34, r)).toBe(5)
  })
})

describe('installGlassLight', () => {
  const box = (cls: string, left: number, top: number, w = 40, h = 40) => {
    const el = document.createElement('div')
    el.className = cls
    el.getBoundingClientRect = () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect
    document.body.appendChild(el)
    return el
  }
  const move = (x: number, y: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))

  it('lights only elements within the radius, relative to them, and clears them after leaving', () => {
    document.body.innerHTML = ''
    const near = box('aether-dock', 100, 100)
    const far = box('menu', 600, 600)
    let pending: (() => void) | null = null
    const dispose = installGlassLight(window, { radius: 140, raf: (cb) => { pending = cb; return 1 } })
    move(160, 120) // 20px right of `near`'s right edge, inside its vertical span
    pending!()
    expect(near.hasAttribute('data-glass-lit')).toBe(true)
    expect(near.style.getPropertyValue('--lx')).toBe('60.0px')
    expect(near.style.getPropertyValue('--ly')).toBe('20.0px')
    expect(Number(near.style.getPropertyValue('--li'))).toBeCloseTo(lightIntensity(20, 140), 3)
    expect(far.hasAttribute('data-glass-lit')).toBe(false)

    move(400, 400) // out of range of both
    pending!()
    expect(near.hasAttribute('data-glass-lit')).toBe(false)
    expect(near.style.getPropertyValue('--li')).toBe('')

    move(160, 120); pending!()
    expect(near.hasAttribute('data-glass-lit')).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(near.hasAttribute('data-glass-lit')).toBe(false)

    // over the header's drag area the main process sends the position instead of pointer events
    window.dispatchEvent(new CustomEvent('aether:pointer', { detail: { x: 120, y: 90 } }))
    pending!()
    expect(near.style.getPropertyValue('--ly')).toBe('-10.0px')
    window.dispatchEvent(new CustomEvent('aether:pointer', { detail: null })) // the cursor left the window
    expect(near.hasAttribute('data-glass-lit')).toBe(false)
    dispose()
  })

  it('does nothing with Reduce Transparency on, and coalesces moves into one frame', () => {
    document.body.innerHTML = ''
    const el = box('menu', 0, 0)
    let calls = 0
    let pending: (() => void) | null = null
    const dispose = installGlassLight(window, { raf: (cb) => { calls++; pending = cb; return 1 } })
    move(10, 10); move(12, 12); move(14, 14)
    expect(calls).toBe(1)
    document.body.classList.add('reduce-transparency')
    pending!()
    expect(el.hasAttribute('data-glass-lit')).toBe(false)
    document.body.classList.remove('reduce-transparency')
    dispose()
  })
})
