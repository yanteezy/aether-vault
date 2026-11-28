// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { legacyText, stateText } from './updates.js'

describe('update texts', () => {
  it('says what the updater found', () => {
    expect(stateText({ state: 'none' }, '0.3.0')).toBe('У вас найновіша версія (0.3.0).')
    expect(stateText({ state: 'available', version: '0.3.1', manual: false }, '0.3.0')).toBe('Доступна версія 0.3.1.')
    expect(stateText({ state: 'downloading', version: '0.3.1', percent: 42 }, '0.3.0')).toBe('Завантажую версію 0.3.1: 42%')
    expect(stateText({ state: 'dev' }, '0.3.0')).toContain('встановленому')
  })
  it('counts the old notes in Ukrainian', () => {
    expect(legacyText({ vaults: 3, notes: 42, target: '' })).toBe('3 сховища, 42 нотатки')
    expect(legacyText({ vaults: 1, notes: 11, target: '' })).toBe('1 сховище, 11 нотаток')
    expect(legacyText({ vaults: 5, notes: 21, target: '' })).toBe('5 сховищ, 21 нотатка')
  })
})
