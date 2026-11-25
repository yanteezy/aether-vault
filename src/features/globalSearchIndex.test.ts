import { describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { searchAll } from './globalSearch'
import { FileStore } from './fileStore'
import { KeyValueBackend, setVaultBackend } from './vaultRepo'
import { fakeLibrary } from '../test/fakeVaultDisk'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('search over vault folders', () => {
  it('asks the index, maps folders to workspaces, and falls back to memory when it fails', async () => {
    const lib = fakeLibrary()
    await lib.io.writeVaultMeta(null, 'Папка', JSON.stringify({ id: 'default' }))
    const store = await FileStore.open({ format: 'files', dirs: { default: 'Папка' } }, lib.io, async () => undefined)
    store.save('default', 'notes', [{ id: 'm', title: 'З памʼяті', tags: [], x: 0, y: 0, width: 1, height: 1 }])
    setVaultBackend(store)
    const vaults = [{ id: 'default', name: 'A', createdAt: 0 }]

    vi.mocked(invoke).mockResolvedValueOnce([
      { vault: 'Папка', id: 'i', title: 'З індексу', snippet: '\u0002пам\u0003ять' },
      { vault: 'Видалене', id: 'x', title: 'ні', snippet: '' },
    ])
    expect(await searchAll('пам', vaults)).toEqual([
      { vaultId: 'default', noteId: 'i', title: 'З індексу', snippet: [{ text: 'пам', hit: true }, { text: 'ять', hit: false }] },
    ])
    expect(invoke).toHaveBeenCalledWith('index_search', { query: 'пам', limit: 30 })

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no index'))
    expect((await searchAll('пам', vaults)).map((f) => f.noteId)).toEqual(['m'])
    setVaultBackend(KeyValueBackend)
  })
})
