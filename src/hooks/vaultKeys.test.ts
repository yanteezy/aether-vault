import { describe, expect, it } from 'vitest'
import { getItem, setItem } from '../features/store'
import { DEFAULT_VAULT_ID, deleteVaultData, vaultKey } from './vaultKeys'

const P = 'aethel-vault:'

describe('vaultKey', () => {
  it('keeps the legacy keys for the default vault', () => expect(vaultKey(DEFAULT_VAULT_ID, 'notes')).toBe('notes'))
  it('prefixes other vaults', () => expect(vaultKey('abc', 'notes')).toBe('vault:abc:notes'))
})

describe('deleteVaultData', () => {
  it('removes only the data of that vault', () => {
    setItem(P + 'vault:a:notes', '[1]')
    setItem(P + 'vault:a:ink', '[]')
    setItem(P + 'vault:b:notes', '[2]')
    setItem(P + 'notes', '[0]')
    deleteVaultData('a')
    expect(getItem(P + 'vault:a:notes')).toBeNull()
    expect(getItem(P + 'vault:a:ink')).toBeNull()
    expect(getItem(P + 'vault:b:notes')).toBe('[2]')
    expect(getItem(P + 'notes')).toBe('[0]')
  })
  it('removes the legacy keys of the default vault but keeps settings', () => {
    for (const k of ['notes', 'connections', 'canvas-transform', 'ink', 'frames', 'chips', 'settings']) setItem(P + k, '1')
    setItem(P + 'vault:b:notes', '[2]')
    deleteVaultData(DEFAULT_VAULT_ID)
    for (const k of ['notes', 'connections', 'canvas-transform', 'ink', 'frames', 'chips']) expect(getItem(P + k)).toBeNull()
    expect(getItem(P + 'settings')).toBe('1')
    expect(getItem(P + 'vault:b:notes')).toBe('[2]')
  })
})
