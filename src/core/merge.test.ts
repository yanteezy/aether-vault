import { describe, expect, it } from 'vitest'
import { mergeText } from './merge.js'

const base = ['# Title', 'one', 'two', 'three', 'four', 'five'].join('\n')

describe('mergeText', () => {
  it('combines edits in different places', () => {
    const ours = base.replace('two', 'TWO (editor)')
    const theirs = base.replace('five', 'five (other app)') + '\nsix'
    expect(mergeText(base, ours, theirs)).toEqual({
      conflict: false,
      text: ['# Title', 'one', 'TWO (editor)', 'three', 'four', 'five (other app)', 'six'].join('\n'),
    })
  })

  it('takes the one side that changed, and identical changes once', () => {
    expect(mergeText(base, base, 'x')).toEqual({ text: 'x', conflict: false })
    const both = base.replace('one', 'ONE')
    expect(mergeText(base, both, both)).toEqual({ text: both, conflict: false })
  })

  it('reports a conflict when both change the same line differently, or insert at the same spot', () => {
    expect(mergeText(base, base.replace('three', 'A'), base.replace('three', 'B')).conflict).toBe(true)
    expect(mergeText(base, `${base}\nours`, `${base}\ntheirs`).conflict).toBe(true)
  })
})
