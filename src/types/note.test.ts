import { describe, expect, it } from 'vitest'
import { AUTO_SCALE_MAX, AUTO_SCALE_MIN, FONT_MAX, FONT_MIN, autoScale, clampFont, pushRecentInk, resolveFontSize } from './note'

describe('resolveFontSize', () => {
  it('keeps auto', () => expect(resolveFontSize('auto')).toBe('auto'))
  it('maps the old S/M/L/XL presets to px', () => {
    expect(resolveFontSize('s')).toBe(13)
    expect(resolveFontSize('m')).toBe(15)
    expect(resolveFontSize('l')).toBe(17)
    expect(resolveFontSize('xl')).toBe(20)
  })
  it('clamps numbers into the allowed range', () => {
    expect(resolveFontSize(2)).toBe(FONT_MIN)
    expect(resolveFontSize(99)).toBe(FONT_MAX)
    expect(resolveFontSize(16.4)).toBe(16)
  })
  it('ignores garbage', () => {
    expect(resolveFontSize(undefined)).toBeUndefined()
    expect(resolveFontSize('huge')).toBeUndefined()
    expect(resolveFontSize(Number.NaN)).toBeUndefined()
  })
  it('clampFont rounds', () => expect(clampFont(14.6)).toBe(15))
})

describe('autoScale', () => {
  it('is 1 for the reference card (260 × 160)', () => expect(autoScale(260, 160)).toBe(1))
  it('never goes below the minimum or above the maximum', () => {
    expect(autoScale(10, 10)).toBe(AUTO_SCALE_MIN)
    expect(autoScale(10000, 10000)).toBe(AUTO_SCALE_MAX)
  })
  it('grows with the card', () => expect(autoScale(520, 320)).toBeGreaterThan(autoScale(260, 160)))
})

describe('pushRecentInk', () => {
  it('puts the colour first, without repeats, max 4', () => {
    expect(pushRecentInk(['chalk', 'cyan', 'lavender', 'amber'], 'lavender')).toEqual(['lavender', 'chalk', 'cyan', 'amber'])
    expect(pushRecentInk(['chalk', 'cyan', 'lavender', 'amber'], '#123456')).toEqual(['#123456', 'chalk', 'cyan', 'lavender'])
  })
  it('compares hex colours case-insensitively', () => {
    expect(pushRecentInk(['#ABCDEF', 'chalk'], '#abcdef')).toEqual(['#abcdef', 'chalk'])
  })
})
