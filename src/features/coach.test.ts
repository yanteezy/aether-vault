import { beforeEach, describe, expect, it, vi } from 'vitest'

const showToast = vi.fn()

describe('coach (earned shortcut tips)', () => {
  let coach: typeof import('./coach')
  beforeEach(async () => {
    showToast.mockClear()
    vi.resetModules()
    vi.doMock('./toast', () => ({ showToast }))
    vi.useFakeTimers()
    coach = await import('./coach')
  })

  const tipsShown = () => {
    vi.runAllTimers()
    return showToast.mock.calls.length
  }

  it('shows the tip after the third mouse use, once', () => {
    coach.coachMouse('duplicate')
    coach.coachMouse('duplicate')
    expect(tipsShown()).toBe(0)
    coach.coachMouse('duplicate')
    expect(tipsShown()).toBe(1)
    expect(showToast.mock.calls[0][0]).toMatchObject({ id: 'tip', kind: 'tip' })
    coach.coachMouse('duplicate')
    expect(tipsShown()).toBe(1)
  })

  it('shows at most one tip per launch', () => {
    for (let i = 0; i < 3; i++) coach.coachMouse('duplicate')
    for (let i = 0; i < 3; i++) coach.coachMouse('delete')
    expect(tipsShown()).toBe(1)
  })

  it('never teaches an action the user already does by key', () => {
    coach.coachKey('palette')
    for (let i = 0; i < 5; i++) coach.coachMouse('palette')
    expect(tipsShown()).toBe(0)
  })

  it('remembers across launches', async () => {
    for (let i = 0; i < 3; i++) coach.coachMouse('draw')
    expect(tipsShown()).toBe(1)
    vi.resetModules()
    const again = await import('./coach')
    for (let i = 0; i < 5; i++) again.coachMouse('draw')
    expect(tipsShown()).toBe(1)
  })
})
