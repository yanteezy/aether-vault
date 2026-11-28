import { describe, expect, it, vi } from 'vitest'
import { Events } from './events.js'

describe('Events', () => {
  it('calls listeners with data and ctx, in order', () => {
    const e = new Events()
    const calls: string[] = []
    const ctx = { id: 'ctx' }
    e.on('x', function (this: typeof ctx, a: number) { calls.push(`${this.id}:${a}`) }, ctx)
    e.on('x', (a: number) => calls.push(`second:${a}`))
    e.trigger('x', 1)
    expect(calls).toEqual(['ctx:1', 'second:1'])
  })

  it('off removes by callback, offref by ref', () => {
    const e = new Events()
    const a = vi.fn()
    const b = vi.fn()
    e.on('x', a)
    const ref = e.on('x', b)
    e.off('x', a)
    e.trigger('x')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    e.offref(ref)
    e.trigger('x')
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('a throwing listener does not stop the next one', () => {
    const e = new Events()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const next = vi.fn()
    e.on('x', () => { throw new Error('boom') })
    e.on('x', next)
    e.trigger('x')
    expect(next).toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('unsubscribing during trigger does not skip others', () => {
    const e = new Events()
    const later = vi.fn()
    const ref = e.on('x', () => e.offref(ref))
    e.on('x', later)
    e.trigger('x')
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('tryTrigger calls one ref directly', () => {
    const e = new Events()
    const fn = vi.fn()
    const ref = e.on('x', fn)
    e.tryTrigger(ref, [1, 2])
    expect(fn).toHaveBeenCalledWith(1, 2)
  })
})
