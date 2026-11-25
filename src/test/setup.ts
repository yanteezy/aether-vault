import './blob-clone'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach } from 'vitest'

// some files run in the plain node environment (no window / localStorage)
const hasDom = typeof window !== 'undefined'

beforeEach(() => {
  if (hasDom) localStorage.clear()
  // every test starts with an empty photo store (modules are re-imported, so no stale connection is kept)
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  if (hasDom) delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})
