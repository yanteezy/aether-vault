import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * WCAG 2.4.3 / 2.1.2 for dialogs: on open, focus moves inside; Tab and Shift+Tab cycle within;
 * on close, focus goes back to whatever opened it.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, initial?: string) {
  useEffect(() => {
    if (!active) return
    const box = ref.current
    if (!box) return
    const opener = document.activeElement as HTMLElement | null
    const items = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))
    const start = () => {
      if (box.contains(document.activeElement)) return
      const first = (initial && box.querySelector<HTMLElement>(initial)) || items()[0]
      ;(first ?? box).focus({ preventScroll: true })
    }
    // after the opening animation has laid things out
    const t = window.setTimeout(start, 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = items()
      if (!list.length) return
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (i === -1) {
        e.preventDefault()
        list[0].focus()
      } else if (e.shiftKey && i === 0) {
        e.preventDefault()
        list[list.length - 1].focus()
      } else if (!e.shiftKey && i === list.length - 1) {
        e.preventDefault()
        list[0].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [active, ref, initial])
}
