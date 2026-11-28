// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { dotStep } from './canvasView.js'

describe('dotStep', () => {
  it('keeps the dots between ~16 and ~33 px apart at any zoom', () => {
    expect(dotStep(1)).toBe(22)
    for (const zoom of [0.05, 0.1, 0.25, 0.33, 0.5, 0.75, 1, 1.4, 2, 3, 5]) {
      const step = dotStep(zoom)
      expect(step).toBeGreaterThanOrEqual(16.5)
      expect(step).toBeLessThanOrEqual(33)
    }
  })
})
