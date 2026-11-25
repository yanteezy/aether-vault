// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { quickYaml } from './quickYaml'
import { serializeNote } from './noteMarkdown'

/** What the full parser makes of it; undefined where it reports an error. */
function full(source: string) {
  const doc = parseDocument(source)
  return doc.errors.length ? undefined : doc.toJS()
}
/** The fast path may give up, but when it answers it must agree with the real parser. */
const agrees = (source: string) => {
  const quick = quickYaml(source)
  if (quick !== undefined) expect([source, quick]).toEqual([source, full(source)])
  return quick !== undefined
}

describe('quickYaml', () => {
  it('reads what Aether writes', () => {
    const text = serializeNote(
      { id: 'note-1', title: 'Нотатка', tags: ['робота', 'ідеї 💡', 'a b'], color: 'blue', style: 'plain', updatedAt: 1795625367115, locked: true, fontSize: 18 },
      { stem: 'Нотатка' },
    )
    const yaml = /^---\n([\s\S]*?)\n---/.exec(text)![1]
    expect(quickYaml(yaml)).toEqual(full(yaml))
    expect(quickYaml(yaml)).toMatchObject({ 'aether-id': 'note-1', 'aether-locked': true, updated: new Date(1795625367115).toISOString() })
  })

  it('gives up on anything that is not plain', () => {
    for (const source of [
      'a: null', 'a: True', 'a: ~', 'a: 0x1F', 'a: 007', 'a: 1.5', 'a: .inf', 'a: "q"', "a: 'q'", 'a: [x]', 'a: {x: 1}',
      'a: x #c', 'a: b: c', 'a: x:', 'a: &x y', 'a: !t y', 'a: |', 'a:', 'a: 1\na: 2', '# note', '', 'a: x\n\nb: y',
      'a:\n  b: c', 'a: x\n- y', 'a:\n  - x\n  - "y"', 'a: x ', 'a: -x', 'a:\tx', 'a: 2026-11-25',
    ]) expect(quickYaml(source), source).toBeUndefined()
  })

  it('never disagrees with the real parser on random input', () => {
    const pieces = ['a', 'b-c', 'Ж', '💡', ' ', ':', ': ', '#', ' #', '-', '- ', '  - ', '\n', 'true', 'null', '1', '0', '.', "'", '"', '[', '{', '!', '&', '*', '~', ',', '?', '%', '@', '`', '|', '>', '\t', 'T', 'Z', '2026-11-25T16:45:05.331Z']
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    let answered = 0
    for (let i = 0; i < 20000; i++) {
      let s = next() < 0.8 ? 'k: ' : ''
      const n = 1 + Math.floor(next() * 8)
      for (let j = 0; j < n; j++) s += pieces[Math.floor(next() * pieces.length)]
      if (agrees(s)) answered++
    }
    // the fast path is used for a fair share, so this test checks something
    expect(answered).toBeGreaterThan(500)
  })
})
