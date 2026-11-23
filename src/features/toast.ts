/**
 * One small message at the bottom of the screen, at a time: "Workspace deleted · Undo", tips.
 * A new toast replaces the current one (its onExpire still runs, so a pending delete is never lost).
 */
export interface ToastSpec {
  id?: string
  text: string
  action?: { label: string; run: () => void }
  /** ms on screen; 0 = until replaced */
  ms?: number
  /** runs when the toast goes away without its action being used */
  onExpire?: () => void
  kind?: 'info' | 'tip'
  /** run onExpire when the app closes while it is still showing (e.g. finish a pending delete) */
  expireOnExit?: boolean
}
type Listener = (t: ToastSpec | null) => void
const listeners = new Set<Listener>()
let currentToast: ToastSpec | null = null

export function showToast(t: ToastSpec) {
  const prev = currentToast
  currentToast = t
  prev?.onExpire?.()
  listeners.forEach((fn) => fn(t))
}
/** The toast went away by itself (timeout) or its action was used (expire = false). */
export function dismissToast(t: ToastSpec, expire: boolean) {
  if (currentToast !== t) return
  currentToast = null
  if (expire) t.onExpire?.()
  listeners.forEach((fn) => fn(null))
}
export function onToast(fn: Listener) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (typeof window !== 'undefined')
  window.addEventListener('aether:flush', () => {
    if (currentToast?.expireOnExit) dismissToast(currentToast, true)
  })
