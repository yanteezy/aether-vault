import { discardVaultRepo, getVaultBackend } from '../features/vaultRepo'
import { keys, removeItem } from '../features/store'

const STORAGE_PREFIX = 'aethel-vault:'

/** The first vault keeps the legacy keys so existing notes survive the upgrade. */
export const DEFAULT_VAULT_ID = 'default'

export function vaultKey(vaultId: string, key: string) {
  return vaultId === DEFAULT_VAULT_ID ? key : `vault:${vaultId}:${key}`
}

/** Delete a vault's data. Its repository goes first, so no pending change is written back afterwards. */
export function deleteVaultData(vaultId: string) {
  discardVaultRepo(vaultId)
  // the key-value backend removes the keys; vault folders go to the trash and the old keys stay
  getVaultBackend().remove(vaultId)
}

/** Remove a vault's stored keys (the key-value backend of features/vaultRepo.ts). */
export function removeVaultKeys(vaultId: string) {
  if (vaultId === DEFAULT_VAULT_ID) {
    for (const k of ['notes', 'connections', 'canvas-transform', 'ink', 'frames', 'chips']) removeItem(STORAGE_PREFIX + k)
    return
  }
  const prefix = `${STORAGE_PREFIX}vault:${vaultId}:`
  keys()
    .filter((k) => k.startsWith(prefix))
    .forEach((k) => removeItem(k))
}
