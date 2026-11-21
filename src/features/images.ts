import { useEffect, useState } from 'react'

/**
 * Photos live in IndexedDB (much more room than localStorage, where notes are kept);
 * a note only stores the image id. Imported photos are downscaled and re-encoded,
 * so a 12-megapixel phone picture becomes a few hundred KB.
 */
export interface NoteImage {
  id: string
  /** cover = fill the note, contain = show the whole picture. */
  fit?: 'cover' | 'contain'
  /** Pan offset in % of the note size. */
  x?: number
  y?: number
  /** 1…4 */
  zoom?: number
  /** Darkening under the text, 0…0.8. */
  dim?: number
  /** Natural size after import (for the aspect ratio of new image notes). */
  w?: number
  h?: number
}

const DB = 'aether-images'
const STORE = 'images'
const MAX_SIDE = 2000

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  return dbPromise
}
function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const getImage = (id: string) => tx<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)
export const deleteImage = (id: string) => tx('readwrite', (s) => s.delete(id))
const putImage = (id: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, id))
const allIds = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())

export const isImageFile = (f: { type: string }) => /^image\//.test(f.type)

/** Decode, downscale and store a picture. Returns its id and size. */
export async function importImage(file: Blob): Promise<{ id: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  // keep transparency for PNG / WebP / GIF, otherwise JPEG is much smaller
  const alpha = /png|webp|gif/.test(file.type)
  const out = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), alpha ? 'image/png' : 'image/jpeg', 0.86),
  )
  const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  await putImage(id, out.size < file.size || k < 1 ? out : file)
  return { id, w, h }
}

const urls = new Map<string, string>()
/** Object URL of a stored image (cached for the session). */
export function useImageUrl(id: string | undefined) {
  const [url, setUrl] = useState(() => (id ? urls.get(id) : undefined))
  useEffect(() => {
    if (!id) return setUrl(undefined)
    const cached = urls.get(id)
    if (cached) return setUrl(cached)
    let alive = true
    getImage(id)
      .then((b) => {
        if (!b || !alive) return
        const u = URL.createObjectURL(b)
        urls.set(id, u)
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [id])
  return url
}

/** Delete stored pictures no note refers to any more (run once, some time after launch). */
export async function collectUnusedImages() {
  const used = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (!/^aethel-vault:(vault:[^:]+:)?notes$/.test(key)) continue
    for (const m of (localStorage.getItem(key) ?? '').matchAll(/"id":"(img-[a-z0-9-]+)"/g)) used.add(m[1])
  }
  const ids = await allIds()
  await Promise.all(ids.filter((id) => typeof id === 'string' && !used.has(id)).map((id) => deleteImage(id as string)))
}
