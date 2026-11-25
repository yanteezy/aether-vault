import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { Frame, NoteCardData } from '../types/note'

const P = 'aethel-vault:'
const note = (id: string, title = id): NoteCardData => ({ id, title, body: '', tags: [], x: 0, y: 0, width: 200, height: 120, updatedAt: 1 })
const frame: Frame = { id: 'f', title: 'F', x: 0, y: 0, width: 300, height: 200, color: 'default' }

// fresh modules per test: the registry and the "suspended" flag are module state
let repoMod: typeof import('./vaultRepo')
let store: typeof import('./store')
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  repoMod = await import('./vaultRepo')
  store = await import('./store')
})
afterEach(() => {
  vi.useRealTimers()
})

/** Writes that reached storage for one key. */
const writesTo = (spy: MockInstance, key: string) => spy.mock.calls.filter((c) => c[0] === key).length

describe('VaultRepository', () => {
  it('tells subscribers about a change, and stops after unsubscribe', () => {
    const repo = repoMod.getVaultRepo('a')
    repo.ensure('notes', [])
    const fn = vi.fn()
    const off = repo.subscribe('notes', fn)
    repo.set('notes', [note('n1')])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(repo.get('notes')).toEqual([note('n1')])
    expect(repo.getNote('n1')?.title).toBe('n1')
    expect(repo.listNotes()).toHaveLength(1)
    off()
    repo.set('notes', (prev) => [...prev, note('n2')])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('only tells subscribers of the changed kind; the same value is no change', () => {
    const repo = repoMod.getVaultRepo('a')
    const notes = repo.ensure('notes', [])
    const onNotes = vi.fn()
    const onInk = vi.fn()
    repo.subscribe('notes', onNotes)
    repo.subscribe('ink', onInk)
    repo.set('notes', notes)
    repo.set('notes', (p) => p)
    expect(onNotes).not.toHaveBeenCalled()
    repo.set('ink', [])
    expect(onInk).toHaveBeenCalledTimes(1)
    expect(onNotes).not.toHaveBeenCalled()
  })

  it('updateNote patches one note and stamps updatedAt', () => {
    const repo = repoMod.getVaultRepo('a')
    repo.set('notes', [note('n1'), note('n2')])
    vi.setSystemTime(5000)
    repo.updateNote('n2', { title: 'new' })
    expect(repo.getNote('n2')).toMatchObject({ title: 'new', updatedAt: 5000 })
    expect(repo.getNote('n1')).toEqual(note('n1'))
  })

  it('writes once per burst of changes, 200 ms after the last one', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const repo = repoMod.getVaultRepo('a')
    repo.ensure('notes', [])
    for (let i = 0; i < 5; i++) {
      repo.set('notes', (p) => [...p, note('n' + i)])
      vi.advanceTimersByTime(100)
    }
    expect(writesTo(spy, P + 'vault:a:notes')).toBe(0)
    vi.advanceTimersByTime(200)
    expect(writesTo(spy, P + 'vault:a:notes')).toBe(1)
    expect(JSON.parse(localStorage.getItem(P + 'vault:a:notes')!)).toHaveLength(5)
  })

  it('flush() (aether:flush) writes the pending changes right away', async () => {
    const repo = repoMod.getVaultRepo('a')
    repo.set('frames', [])
    repo.set('chips', [{ id: 'c', tag: 't', color: 'blue', x: 1, y: 2 }])
    expect(localStorage.getItem(P + 'vault:a:chips')).toBeNull()
    await store.flush()
    expect(localStorage.getItem(P + 'vault:a:frames')).toBe('[]')
    expect(localStorage.getItem(P + 'vault:a:chips')).toBe('[{"id":"c","tag":"t","color":"blue","x":1,"y":2}]')
  })

  it('beforeunload writes the pending changes', () => {
    repoMod.getVaultRepo('a').set('ink', [])
    window.dispatchEvent(new Event('beforeunload'))
    expect(localStorage.getItem(P + 'vault:a:ink')).toBe('[]')
  })

  it('suspendPersistence() blocks every write', async () => {
    const { suspendPersistence } = await import('../hooks/usePersistentState')
    const repo = repoMod.getVaultRepo('a')
    repo.set('notes', [note('n1')])
    suspendPersistence()
    await store.flush()
    repo.set('notes', [note('n2')])
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem(P + 'vault:a:notes')).toBeNull()
  })

  it('does not save the starting value until something changes', () => {
    const repo = repoMod.getVaultRepo('a')
    repo.ensure('notes', [note('guide')])
    vi.advanceTimersByTime(1000)
    window.dispatchEvent(new Event('aether:flush'))
    expect(localStorage.getItem(P + 'vault:a:notes')).toBeNull()
    expect(repo.listNotes()).toEqual([note('guide')])
  })

  it('reads 0.2.x data as it is and writes it back in the same format', async () => {
    // fixture: keys exactly as 0.2.x stores them (default vault without prefix, others with vault:<id>:)
    const legacy: Record<string, unknown> = {
      notes: [note('n1', 'Привіт')],
      connections: [{ id: 'k', from: 'n1', to: 'n1', fromSide: 'right', toSide: 'left' }],
      frames: [frame],
      chips: [],
      ink: [{ id: 's', x: 1, y: 2, points: [0, 0, 3, 4], color: 'chalk', tool: 'pen' }],
      'canvas-transform': { x: 10, y: -5, scale: 0.8 },
    }
    for (const [k, v] of Object.entries(legacy)) {
      localStorage.setItem(P + k, JSON.stringify(v))
      localStorage.setItem(P + 'vault:v1:' + k, JSON.stringify(v))
    }
    for (const id of ['default', 'v1']) {
      const repo = repoMod.getVaultRepo(id)
      for (const kind of repoMod.VAULT_KINDS) expect(repo.get(kind)).toEqual(legacy[kind])
    }
    const before: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) before[localStorage.key(i)!] = localStorage.getItem(localStorage.key(i)!)!
    repoMod.getVaultRepo('default').set('notes', (p) => [...p, note('n2')])
    await store.flush()
    expect(localStorage.getItem(P + 'notes')).toBe(JSON.stringify([note('n1', 'Привіт'), note('n2')]))
    for (const k of Object.keys(before)) if (k !== P + 'notes') expect(localStorage.getItem(k)).toBe(before[k])
  })

  it('a bad stored value falls back to the starting value', () => {
    localStorage.setItem(P + 'vault:a:notes', '{nope')
    expect(repoMod.getVaultRepo('a').ensure('notes', [note('x')])).toEqual([note('x')])
  })
})

describe('registry', () => {
  it('gives one repository per vault', () => {
    expect(repoMod.getVaultRepo('a')).toBe(repoMod.getVaultRepo('a'))
    expect(repoMod.getVaultRepo('a')).not.toBe(repoMod.getVaultRepo('b'))
  })

  it('saves and forgets a vault nobody shows any more', async () => {
    const repo = repoMod.getVaultRepo('a')
    const off = repo.subscribe('notes', () => {})
    repo.set('notes', [note('n1')])
    off()
    // unsubscribe → subscribe in the same tick (React StrictMode) keeps it
    const off2 = repo.subscribe('notes', () => {})
    await Promise.resolve()
    expect(repoMod.getVaultRepo('a')).toBe(repo)
    off2()
    await Promise.resolve()
    expect(localStorage.getItem(P + 'vault:a:notes')).toBe(JSON.stringify([note('n1')]))
    const again = repoMod.getVaultRepo('a')
    expect(again).not.toBe(repo)
    expect(again.listNotes()).toEqual([note('n1')])
  })

  it('deleteVaultData drops the repository first: pending changes are not written back', async () => {
    const { deleteVaultData } = await import('../hooks/vaultKeys')
    localStorage.setItem(P + 'vault:a:notes', '[]')
    const repo = repoMod.getVaultRepo('a')
    repo.set('notes', [note('n1')])
    deleteVaultData('a')
    vi.advanceTimersByTime(1000)
    await store.flush()
    repo.set('notes', [note('n2')])
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem(P + 'vault:a:notes')).toBeNull()
    expect(repoMod.getVaultRepo('a')).not.toBe(repo)
  })

  it('works over any VaultBackend', () => {
    const backend = { load: vi.fn(() => ({ ink: [] })), save: vi.fn(), remove: vi.fn() }
    const repo = new repoMod.VaultRepository('x', backend)
    expect(backend.load).toHaveBeenCalledWith('x')
    expect(repo.get('ink')).toEqual([])
    repo.set('ink', repo.get('ink')!)
    repo.set('notes', [note('n')])
    vi.advanceTimersByTime(200)
    expect(backend.save).toHaveBeenCalledWith('x', 'notes', [note('n')], { ink: [], notes: [note('n')] })
    expect(backend.save).toHaveBeenCalledTimes(1)
  })
})
