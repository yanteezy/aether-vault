import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { UnreadableNotice } from './UnreadableNotice'
import { FileStore } from '../features/fileStore'
import { setVaultBackend, KeyValueBackend } from '../features/vaultRepo'
import { fakeLibrary } from '../test/fakeVaultDisk'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const render = async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(createElement(UnreadableNotice)))
  return { host, root }
}

describe('UnreadableNotice', () => {
  it('names the files that are missing from the board, and can be closed', async () => {
    const lib = fakeLibrary()
    await lib.io.writeVaultMeta(null, 'V', JSON.stringify({ id: 'default' }))
    lib.at('V').disk.notes.set('Зламана.md', '---\na: [1\n---\n')
    setVaultBackend(await FileStore.open({ format: 'files', dirs: { default: 'V' } }, lib.io, async () => undefined))
    const { host, root } = await render()
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('V/Зламана.md')
    await act(async () => [...host.querySelectorAll('button')].at(-1)!.click())
    expect(host.textContent).toBe('')
    await act(async () => root.unmount())
    setVaultBackend(KeyValueBackend)
  })

  it('shows nothing when everything was read', async () => {
    expect((await render()).host.textContent).toBe('')
  })
})
