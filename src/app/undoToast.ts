/**
 * The "done — undo?" toast for actions Ctrl+Z cannot take back (trash, tag removal across notes, plugin uninstall).
 * The action has already happened; the ring empties from its end while the seconds run out, and
 * «Скасувати» calls `undo`. Hover or keyboard focus pauses the countdown (WCAG 2.2.1, timing adjustable),
 * and Ctrl/⌘+Z undoes the newest toast where nothing else owns Ctrl+Z (not in text, not on the canvas),
 * so keyboard users need not Tab to it.
 */
import { Notice } from './ui.js'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
/** Undo buttons of the toasts, newest last. */
const live: HTMLButtonElement[] = []
let keyListening = false
function listenForUndoKey() {
  if (keyListening) return
  keyListening = true
  window.addEventListener('keydown', (e) => {
    // e.code: the Z key on any layout (Ukrainian gives e.key 'я')
    const newest = live.findLast((b) => b.isConnected && !b.disabled)
    if (!newest || e.code !== 'KeyZ' || !(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return
    // text and the canvas keep their own undo: a newer change there must not bring back the toast's action
    if ((document.activeElement as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"], .cm-editor, .canvas-wrapper')) return
    e.preventDefault()
    e.stopPropagation()
    newest.click()
  }, true)
}

const SVG = 'http://www.w3.org/2000/svg'
const R = 11
const C = 2 * Math.PI * R

export interface UndoToast { el: HTMLElement; dismiss(): void }

export function undoToast(message: string, undo: () => Promise<unknown> | unknown, seconds = 10): UndoToast {
  listenForUndoKey()
  let host = document.body.querySelector<HTMLElement>('.undo-toast-host')
  host ??= document.body.createDiv({ cls: 'undo-toast-host', attr: { role: 'status', 'aria-live': 'polite' } })
  const el = host.createDiv({ cls: 'undo-toast' })
  el.style.setProperty('--undo-ms', `${seconds * 1000}ms`)

  const ring = el.createDiv({ cls: 'undo-toast-ring', attr: { 'aria-hidden': 'true' } })
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 28 28')
  for (const cls of ['undo-toast-track', 'undo-toast-arc']) {
    const c = document.createElementNS(SVG, 'circle')
    c.setAttribute('cx', '14'); c.setAttribute('cy', '14'); c.setAttribute('r', String(R))
    c.classList.add(cls)
    svg.appendChild(c)
  }
  svg.lastElementChild!.setAttribute('stroke-dasharray', String(C))
  ring.appendChild(svg)
  const count = ring.createSpan({ cls: 'undo-toast-count', text: String(seconds) })

  el.createDiv({ cls: 'undo-toast-text', text: message })
  const keys = isMac ? '⌘Z' : 'Ctrl+Z'
  const button = el.createEl('button', { cls: 'undo-toast-undo', attr: { 'aria-keyshortcuts': isMac ? 'Meta+Z' : 'Control+Z' } })
  button.createSpan({ text: 'Скасувати' })
  button.createEl('kbd', { text: keys })
  live.push(button)

  // time left, paused while the pointer or focus is on the toast
  let left = seconds * 1000
  let last = performance.now()
  let paused = false
  const tick = () => {
    const now = performance.now()
    if (!paused) left -= now - last
    last = now
    count.setText(String(Math.max(1, Math.ceil(left / 1000))))
    if (left <= 0) dismiss()
  }
  const timer = window.setInterval(tick, 200)
  const pause = (on: boolean) => { tick(); paused = on; el.toggleClass('is-paused', on) }
  el.addEventListener('pointerenter', () => pause(true))
  el.addEventListener('pointerleave', () => { if (!el.contains(document.activeElement)) pause(false) })
  el.addEventListener('focusin', () => pause(true))
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget as Node) && !el.matches(':hover')) pause(false) })

  let gone = false
  function dismiss() {
    if (gone) return
    gone = true
    live.splice(live.indexOf(button), 1)
    window.clearInterval(timer)
    el.addClass('is-leaving')
    const remove = () => { el.remove(); if (!host!.childElementCount) host!.remove() }
    el.addEventListener('animationend', remove, { once: true })
    window.setTimeout(remove, 400) // reduced motion: no animationend
  }

  button.addEventListener('click', async () => {
    if (gone) return
    window.clearInterval(timer)
    button.disabled = true
    try {
      await undo()
      dismiss()
      new Notice('Скасовано.', 2500)
    } catch (e) {
      console.error(e)
      dismiss()
      new Notice(`Не вдалося скасувати: ${e instanceof Error ? e.message : e}`, 0)
    }
  })

  return { el, dismiss }
}
