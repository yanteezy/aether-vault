import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { noteFileName, readAttachment, writeAttachment } from './vaultFs'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const call = vi.mocked(invoke)

describe('vaultFs', () => {
  beforeEach(() => call.mockReset())

  it('sends non-Latin vault names in headers as ASCII', async () => {
    const bytes = new Uint8Array([1])
    await writeAttachment('Моя дошка 100%', 'img-1.png', bytes)
    const [command, body, options] = call.mock.calls[0] as [string, Uint8Array, { headers: Record<string, string> }]
    expect([command, body]).toEqual(['attachment_write', bytes])
    expect(options.headers['x-vault']).toMatch(/^[\x20-\x7e]+$/)
    expect(decodeURIComponent(options.headers['x-vault'])).toBe('Моя дошка 100%')
  })

  it('treats an empty answer as a missing attachment', async () => {
    call.mockResolvedValueOnce(new ArrayBuffer(0)).mockResolvedValueOnce(new Uint8Array([7]).buffer)
    expect(await readAttachment('v', 'a.png')).toBeUndefined()
    expect(await readAttachment('v', 'a.png')).toEqual(new Uint8Array([7]))
  })

  it('passes the current file name when asking for a new one', async () => {
    await noteFileName('v', 'Назва')
    expect(call).toHaveBeenCalledWith('note_name', { vault: 'v', title: 'Назва', currentFile: null })
  })
})
