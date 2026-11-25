import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeLibrary } from '../test/fakeVaultDisk'

const P = 'aethel-vault:'
const put = (k: string, v: unknown) => localStorage.setItem(P + k, JSON.stringify(v))
const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, tags: [], x: 0, y: 0, width: 260, height: 160, ...extra })
const oldData = () => {
  put('vaults', [
    { id: 'default', name: 'Головне', createdAt: 1 },
    { id: 'b', name: 'Друге', createdAt: 2 },
  ])
  put('notes', [note('n1', { image: { id: 'img-1' } })])
  put('vault:b:notes', [note('m1')])
}

describe('switching to vault folders', () => {
  let mod: typeof import('./fileStore')
  let repo: typeof import('./vaultRepo')
  let store: typeof import('./store')
  let images: typeof import('./images')
  let backup: typeof import('./backup')
  let keys: typeof import('../hooks/vaultKeys')
  let lib: ReturnType<typeof fakeLibrary>
  const safety = vi.fn(async () => {})

  /** A new launch: fresh modules, the same disk and storage. */
  const launch = async (migrate = true) => {
    vi.resetModules()
    mod = await import('./fileStore')
    repo = await import('./vaultRepo')
    store = await import('./store')
    images = await import('./images')
    backup = await import('./backup')
    keys = await import('../hooks/vaultKeys')
    return mod.startFileStore({ io: lib.io, photo: async () => ({ bytes: new Uint8Array([1]), ext: 'png' }), migrate, backup: safety })
  }
  const files = async () => {
    const result = await launch()
    if (result.mode !== 'files') throw new Error(JSON.stringify(result))
    return result.store
  }

  beforeEach(() => {
    lib = fakeLibrary()
    safety.mockReset()
    safety.mockResolvedValue(undefined)
  })

  it('does nothing in a build that may not migrate', async () => {
    oldData()
    expect((await launch(false)).mode).toBe('keys')
    expect(lib.folders.size).toBe(0)
    expect(safety).not.toHaveBeenCalled()
  })

  it('backs up first, moves, leaves the old keys, and stays on files afterwards', async () => {
    oldData()
    const before = localStorage.getItem(P + 'notes')
    safety.mockImplementation(async () => expect(lib.folders.size).toBe(0))
    const first = await files()
    expect(first.load('default').notes![0].id).toBe('n1')
    expect([...lib.at('Головне').attachments]).toEqual(['img-1.png'])
    expect(localStorage.getItem(P + 'notes')).toBe(before)
    // even a build that may not migrate keeps using files once moved
    const again = await launch(false)
    expect(again.mode).toBe('files')
    expect(safety).toHaveBeenCalledTimes(1)
  })

  it('writes edits to the folder, not to the old keys', async () => {
    oldData()
    await files()
    const before = localStorage.getItem(P + 'notes')
    const vault = repo.getVaultRepo('default')
    vault.set('notes', [{ ...vault.listNotes()[0], body: 'нове' }])
    expect(await store.flush()).toBe(true)
    expect(lib.at('Головне').disk.notes.get('n1.md')).toContain('нове')
    expect(localStorage.getItem(P + 'notes')).toBe(before)
    expect((await files()).load('default').notes![0].body).toBe('нове')
  })

  it('stays on the old keys when the safety copy, a damaged key or a bad write stops the move', async () => {
    oldData()
    safety.mockRejectedValueOnce(new Error('no space'))
    expect(await launch()).toMatchObject({ mode: 'failed', reason: 'no space' })
    expect(lib.folders.size).toBe(0)

    localStorage.setItem(P + 'ink', '{oops')
    expect(await launch()).toMatchObject({ mode: 'failed', reason: 'damaged data: ink' })
    localStorage.removeItem(P + 'ink')

    lib.corrupt(true)
    expect((await launch()).mode).toBe('failed')
    expect(localStorage.getItem(P + 'storage-format')).toBeNull()
    expect(repo.getVaultBackend()).toBe(repo.KeyValueBackend)
    lib.corrupt(false)
    expect((await launch()).mode).toBe('files')
  })

  it('refuses to start when a vault folder is gone', async () => {
    oldData()
    await files()
    lib.folders.delete('Друге')
    await expect(launch()).rejects.toThrow('missing-dir:Друге')
  })

  it('gives a new vault its own folder, with the starting content that was never edited', async () => {
    oldData()
    await files()
    put('vaults', [{ id: 'v9', name: 'Посібник', createdAt: 3 }])
    const vault = repo.getVaultRepo('v9')
    vault.ensure('notes', [note('guide')])
    vault.set('canvas-transform', { x: 5, y: 5, scale: 1 })
    vault.flush()
    expect(await store.flush()).toBe(true)
    expect((await files()).load('v9').notes!.map((n) => n.id)).toEqual(['guide'])
    expect(lib.folders.has('Посібник')).toBe(true)
  })

  it('moves a deleted vault to the trash', async () => {
    oldData()
    await files()
    keys.deleteVaultData('b')
    expect(await store.flush()).toBe(true)
    expect(lib.trashed).toEqual(['Друге'])
    expect((await files()).load('b')).toEqual({})
  })

  it('keeps a change while the disk fails, says so, and saves it on the next try', async () => {
    oldData()
    const fs = await files()
    lib.at('Головне').disk.fail('write')
    fs.save('default', 'notes', [{ ...fs.load('default').notes![0], body: 'x' }])
    expect(await store.flush()).toBe(false)
    expect(store.saveStatus()).toMatchObject({ state: 'error', reason: 'full' })
    expect(fs.pending).toBe(true)
    lib.at('Головне').disk.fail()
    expect(await store.flush()).toBe(true)
    expect(store.saveStatus()).toEqual({ state: 'ok' })
  })

  it('backs up and imports through vault folders', async () => {
    oldData()
    const fs = await files()
    fs.save('default', 'notes', [note('only-in-files')])
    const copy = await backup.createBackup(['notes'])
    expect(JSON.stringify(copy.notes!.vaults[0].data.notes)).toContain('only-in-files')

    copy.notes!.vaults[0].data.notes = [note('imported')]
    copy.notes!.images = {}
    await backup.applyBackup(copy, ['notes'])
    expect((await files()).load('default').notes!.map((n) => n.id)).toEqual(['imported'])
    // the replaced folders are in the trash, not gone
    expect(lib.trashed).toContain('Головне')
  })

  it('gives the search index what is on disk, and tells it after a write', async () => {
    oldData()
    const fs = await files()
    const written = vi.fn()
    fs.onWritten = written
    expect([...fs.indexed()[0].notes.keys()]).toEqual(['n1.md'])
    fs.save('default', 'notes', [note('n1', { title: 'Нова' })])
    await store.flush()
    expect([...fs.indexed()[0].notes.keys()]).toEqual(['Нова.md'])
    expect(written).toHaveBeenCalled()
  })

  it('never tidies away a photo that only the vault folders know about', async () => {
    oldData()
    const fs = await files()
    images.setPhotoUsers(() => fs.usedImages())
    await images.putImage('img-new', new Blob(['x'], { type: 'image/png' }))
    await images.putImage('img-unused', new Blob(['y'], { type: 'image/png' }))
    fs.save('default', 'notes', [note('n', { image: { id: 'img-new' } })])
    await images.collectUnusedImages()
    expect(await images.allIds()).toEqual(['img-new'])
  })
})
