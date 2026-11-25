import { describe, expect, it } from 'vitest'
import { viewRect, visibleNotes } from './canvasCull'

const note = (id: string, x: number, y: number) => ({ id, title: id, tags: [], x, y, width: 260, height: 160 })

describe('canvas culling', () => {
  it('covers the screen plus a quarter screen around it, at any zoom', () => {
    expect(viewRect({ x: 0, y: 0, scale: 1 }, 1000, 800)).toEqual({ x0: -250, y0: -200, x1: 1250, y1: 1000 })
    expect(viewRect({ x: 100, y: 0, scale: 0.5 }, 1000, 800)).toEqual({ x0: -700, y0: -400, x1: 2300, y1: 2000 })
  })

  it('keeps notes that reach into the view and pinned ones, in board order', () => {
    const notes = [note('far', 9000, 0), note('edge', -500, 0), note('in', 100, 100), note('tall', 0, -450), note('gone', 0, 9000)]
    const view = viewRect({ x: 0, y: 0, scale: 1 }, 1000, 800)
    const ids = (pinned: string[], sizes = new Map()) => visibleNotes(notes, view, sizes, new Set(pinned)).map((n) => n.id)
    expect(ids([])).toEqual(['edge', 'in'])
    expect(ids(['gone'])).toEqual(['edge', 'in', 'gone'])
    // a card grown taller than its stored height is measured by its real size
    expect(ids([], new Map([['tall', { width: 260, height: 400 }]]))).toEqual(['edge', 'in', 'tall'])
  })
})
