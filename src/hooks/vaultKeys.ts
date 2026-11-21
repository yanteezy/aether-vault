const STORAGE_PREFIX = 'aethel-vault:'

/** The first vault keeps the legacy keys so existing notes survive the upgrade. */
export const DEFAULT_VAULT_ID = 'default'

export function vaultKey(vaultId: string, key: string) {
  return vaultId === DEFAULT_VAULT_ID ? key : `vault:${vaultId}:${key}`
}

export function deleteVaultData(vaultId: string) {
  if (vaultId === DEFAULT_VAULT_ID) {
    for (const k of ['notes', 'connections', 'canvas-transform', 'ink', 'frames', 'chips']) localStorage.removeItem(STORAGE_PREFIX + k)
    return
  }
  const prefix = `${STORAGE_PREFIX}vault:${vaultId}:`
  Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix))
    .forEach((k) => localStorage.removeItem(k))
}
