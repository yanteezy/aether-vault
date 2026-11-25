import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '../test/renderHook'
import type { NoteCardData } from '../types/note'

const P = 'aethel-vault:'
const note = (id: string): NoteCardData => ({ id, title: id, body: '', tags: [], x: 0, y: 0, width: 200, height: 120, updatedAt: 1 })

let useVaultData: typeof import('./useVaultData').useVaultData
let repoMod: typeof import('../features/vaultRepo')
beforeEach(async () => {
  vi.resetModules()
  useVaultData = (await import('./useVaultData')).useVaultData
  repoMod = await import('../features/vaultRepo')
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useVaultData', () => {
  it('starts with the stored value, or the starting one', () => {
    localStorage.setItem(P + 'vault:a:notes', JSON.stringify([note('stored')]))
    const a = renderHook(() => useVaultData('a', 'notes', []))
    const b = renderHook(() => useVaultData('b', 'notes', [note('guide')]))
    expect(a.result.current[0]).toEqual([note('stored')])
    expect(b.result.current[0]).toEqual([note('guide')])
  })

  it('two hooks on one vault see the same change', () => {
    const one = renderHook(() => useVaultData('a', 'notes', []))
    const two = renderHook(() => useVaultData('a', 'notes', []))
    act(() => one.result.current[1]((prev) => [...prev, note('n1')]))
    expect(two.result.current[0]).toEqual([note('n1')])
    expect(one.result.current[0]).toBe(two.result.current[0])
    // a change made outside React (another view) reaches both
    act(() => repoMod.getVaultRepo('a').updateNote('n1', { title: 'x' }))
    expect(one.result.current[0][0].title).toBe('x')
    expect(two.result.current[0][0].title).toBe('x')
  })

  it('keeps setValue stable across renders', () => {
    const h = renderHook(() => useVaultData('a', 'ink', []))
    const set = h.result.current[1]
    act(() => set([]))
    act(() => set((p) => [...p]))
    expect(h.result.current[1]).toBe(set)
  })

  it('saves the last change when the view goes away', async () => {
    vi.useFakeTimers()
    const h = renderHook(() => useVaultData('a', 'frames', []))
    act(() => h.result.current[1]([{ id: 'f', title: 'F', x: 0, y: 0, width: 1, height: 1, color: 'default' }]))
    h.unmount()
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(P + 'vault:a:frames')!)).toHaveLength(1)
  })
})
