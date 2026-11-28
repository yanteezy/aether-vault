// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_INK, inkColor, recentInk, useInk } from './ink.js'

describe('drawing colours', () => {
  beforeEach(() => localStorage.clear())
  it('starts with four colours, the first one chosen', () => {
    expect(recentInk()).toEqual(DEFAULT_INK)
    expect(inkColor()).toBe(DEFAULT_INK[0])
  })
  it('a new colour goes first and pushes the oldest out; a recent one keeps its place', () => {
    useInk('#00FF00')
    expect(recentInk()).toEqual(['#00ff00', ...DEFAULT_INK.slice(0, 3)])
    expect(inkColor()).toBe('#00ff00')
    useInk(DEFAULT_INK[1])
    expect(recentInk()).toEqual(['#00ff00', ...DEFAULT_INK.slice(0, 3)])
    expect(inkColor()).toBe(DEFAULT_INK[1])
  })
  it('ignores what is not a colour', () => {
    useInk('red; background: url(x)')
    localStorage.setItem('ink-recent', '["x"]')
    expect(recentInk()).toEqual(DEFAULT_INK)
    expect(inkColor()).toBe(DEFAULT_INK[0])
  })
})
