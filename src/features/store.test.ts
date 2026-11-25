import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = 'aethel-vault:'

describe('store — browser mode (localStorage)', () => {
  let store: typeof import('./store')
  beforeEach(async () => {
    vi.resetModules()
    store = await import('./store')
  })

  it('is not the desktop app', () => expect(store.isDesktop()).toBe(false))

  it('reads back what was written', () => {
    store.setItem(P + 'x', 'hello')
    expect(store.getItem(P + 'x')).toBe('hello')
    expect(localStorage.getItem(P + 'x')).toBe('hello')
    store.removeItem(P + 'x')
    expect(store.getItem(P + 'x')).toBeNull()
  })

  it('readJson / writeJson add the prefix and survive bad JSON', () => {
    store.writeJson('settings', { a: 1 })
    expect(localStorage.getItem(P + 'settings')).toBe('{"a":1}')
    expect(store.readJson('settings')).toEqual({ a: 1 })
    localStorage.setItem(P + 'broken', '{nope')
    expect(store.readJson('broken')).toBeUndefined()
    expect(store.readJson('missing')).toBeUndefined()
  })

  it('lists every key', () => {
    store.setItem(P + 'a', '1')
    store.setItem('other', '2')
    expect(store.keys().sort()).toEqual([P + 'a', 'other'])
  })

  it('reports a full storage and does not swallow the error', () => {
    const seen: string[] = []
    store.onSaveStatus((s) => seen.push(s.state === 'error' ? s.reason : 'ok'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => store.setItem(P + 'big', 'x')).toThrow()
    expect(store.saveStatus()).toMatchObject({ state: 'error', reason: 'full' })
    // the next successful write clears the banner
    store.setItem(P + 'small', 'y')
    expect(store.saveStatus()).toEqual({ state: 'ok' })
    expect(seen).toEqual(['full', 'ok'])
  })

  it('flush() tells open editors to hand over their changes', async () => {
    const onFlush = vi.fn()
    window.addEventListener('aether:flush', onFlush)
    expect(await store.flush()).toBe(true)
    window.removeEventListener('aether:flush', onFlush)
    expect(onFlush).toHaveBeenCalledOnce()
  })
})

describe('store — desktop mode (data folder via Tauri)', () => {
  let store: typeof import('./store')
  let disk: Map<string, string>
  let failWrites = false
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    switch (cmd) {
      case 'data_load':
        return { dir: 'C:/data', custom: false, fresh: false, entries: Object.fromEntries(disk) }
      case 'data_write':
        if (failWrites) throw new Error('os error 28: no space left on device')
        disk.set(args!.key as string, args!.value as string)
        return null
      case 'data_remove':
        disk.delete(args!.key as string)
        return null
      default:
        return null
    }
  })

  beforeEach(async () => {
    disk = new Map([['notes', '[{"id":"n1"}]']])
    failWrites = false
    invoke.mockClear()
    vi.resetModules()
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    store = await import('./store')
    await store.initStore()
  })
  afterEach(() => {
    vi.doUnmock('@tauri-apps/api/core')
  })

  it('loads the data folder into memory before the app starts', () => {
    expect(store.isDesktop()).toBe(true)
    expect(store.getItem(P + 'notes')).toBe('[{"id":"n1"}]')
    expect(store.dataDir()).toEqual({ dir: 'C:/data', custom: false })
  })

  it('writes changes to disk without the prefix, and only once per unchanged value', async () => {
    store.setItem(P + 'vault:a:notes', '[]')
    expect(await store.flush()).toBe(true)
    expect(disk.get('vault:a:notes')).toBe('[]')
    // nothing in localStorage: the data lives in the folder
    expect(localStorage.getItem(P + 'vault:a:notes')).toBeNull()
    invoke.mockClear()
    store.setItem(P + 'vault:a:notes', '[]')
    await store.flush()
    expect(invoke).not.toHaveBeenCalledWith('data_write', expect.anything())
  })

  it('coalesces quick writes of the same key into the latest value', async () => {
    store.setItem(P + 'notes', '1')
    store.setItem(P + 'notes', '2')
    store.setItem(P + 'notes', '3')
    await store.flush()
    expect(disk.get('notes')).toBe('3')
    const writes = invoke.mock.calls.filter(([c]) => c === 'data_write')
    expect(writes.length).toBeLessThanOrEqual(2)
  })

  it('removes a key from disk', async () => {
    store.removeItem(P + 'notes')
    await store.flush()
    expect(disk.has('notes')).toBe(false)
  })

  it('keeps a failed write, reports it, and saves it on retry', async () => {
    failWrites = true
    store.setItem(P + 'notes', '[{"id":"n2"}]')
    expect(await store.flush()).toBe(false)
    expect(store.saveStatus()).toMatchObject({ state: 'error', reason: 'full' })
    expect(disk.get('notes')).toBe('[{"id":"n1"}]')
    // memory already has the new value: nothing is lost while the disk is full
    expect(store.getItem(P + 'notes')).toBe('[{"id":"n2"}]')

    failWrites = false
    store.retrySaving()
    expect(await store.flush()).toBe(true)
    expect(disk.get('notes')).toBe('[{"id":"n2"}]')
    expect(store.saveStatus()).toEqual({ state: 'ok' })
  })
})

describe('store — first launch with a data folder', () => {
  it('copies the notes from the webview storage into the folder and keeps the originals', async () => {
    localStorage.setItem(P + 'notes', '[{"id":"old"}]')
    localStorage.setItem('splash-seen', '1')
    const disk = new Map<string, string>()
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === 'data_load') return { dir: 'C:/data', custom: false, fresh: true, entries: {} }
      if (cmd === 'data_write') disk.set(args!.key as string, args!.value as string)
      if (cmd === 'image_list') return []
      return null
    })
    vi.resetModules()
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const store = await import('./store')
    await store.initStore()
    vi.doUnmock('@tauri-apps/api/core')

    expect(disk.get('notes')).toBe('[{"id":"old"}]')
    expect(disk.has('splash-seen')).toBe(false)
    expect(localStorage.getItem(P + 'notes')).toBe('[{"id":"old"}]')
    expect(invoke).toHaveBeenCalledWith('data_ready')
  })
})
