import { useCallback, useRef, useSyncExternalStore } from 'react'
import { getVaultRepo, type Updater, type VaultData, type VaultKind } from '../features/vaultRepo'

/**
 * One kind of a vault's data, from its repository (`features/vaultRepo.ts`).
 * Same shape as `usePersistentState`: `[value, setValue]`, `setValue` takes a value or an updater and is stable.
 * `initial` is used when nothing is stored yet (it is not saved until the first change).
 */
export function useVaultData<K extends VaultKind>(vaultId: string, kind: K, initial: VaultData[K]) {
  const initialRef = useRef(initial)
  // always go through the registry: a repository released while nobody showed the vault is re-created from storage
  const subscribe = useCallback((fn: () => void) => getVaultRepo(vaultId).subscribe(kind, fn), [vaultId, kind])
  const getSnapshot = useCallback(() => getVaultRepo(vaultId).ensure(kind, initialRef.current), [vaultId, kind])
  const value = useSyncExternalStore(subscribe, getSnapshot)
  const setValue = useCallback((next: Updater<VaultData[K]>) => getVaultRepo(vaultId).set(kind, next), [vaultId, kind])
  return [value, setValue] as const
}
