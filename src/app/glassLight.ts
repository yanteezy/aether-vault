/**
 * The cursor as a small light source for Liquid Glass (docs/design/liquid-glass.md).
 * One passive pointermove listener, coalesced into one requestAnimationFrame. Per frame it reads the rects of the
 * (few dozen) glass elements, then writes `--lx/--ly/--li` + `data-glass-lit` only on those within LIGHT_RADIUS of
 * the pointer and clears the ones it left. CSS (glass-light.css) turns the variables into a rim highlight and a faint glow.
 */
export const LIGHT_RADIUS = 140
export const GLASS_SELECTOR =
  '.aether-dock, .menu, .modal, .notice, .suggestion-container, .aether-segmented, .aether-button, .clickable-icon.aether-header-icon'

/** 1 at the pointer, 0 at `radius` and beyond; smoothstep so the glow has no visible edge. */
export function lightIntensity(distance: number, radius = LIGHT_RADIUS): number {
  if (!(distance < radius)) return 0
  const t = 1 - Math.max(0, distance) / radius
  return t * t * (3 - 2 * t)
}

/** Distance from a point to the nearest point of a rect (0 inside it). */
export function rectDistance(x: number, y: number, r: { left: number; top: number; right: number; bottom: number }): number {
  const dx = Math.max(r.left - x, 0, x - r.right)
  const dy = Math.max(r.top - y, 0, y - r.bottom)
  return Math.hypot(dx, dy)
}

interface Options { radius?: number; raf?: (cb: () => void) => unknown; cancelRaf?: (id: any) => void }

/** Returns a dispose function. */
export function installGlassLight(win: Window = window, opts: Options = {}): () => void {
  const doc = win.document
  const radius = opts.radius ?? LIGHT_RADIUS
  const raf = opts.raf ?? ((cb) => win.requestAnimationFrame(cb))
  const cancel = opts.cancelRaf ?? ((id) => win.cancelAnimationFrame(id))
  const queries = typeof win.matchMedia === 'function'
    ? ['(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)'].map((q) => win.matchMedia(q))
    : []
  const off = () => queries.some((q) => q.matches) || doc.body.classList.contains('reduce-transparency')

  let pointer: { x: number; y: number } | null = null
  let frame: unknown = null
  const lit = new Set<HTMLElement>()

  const clear = (el: HTMLElement) => {
    el.removeAttribute('data-glass-lit')
    el.style.removeProperty('--lx'); el.style.removeProperty('--ly'); el.style.removeProperty('--li')
  }
  const clearAll = () => { for (const el of lit) clear(el); lit.clear() }

  const update = () => {
    frame = null
    if (!pointer || off() || doc.hidden) return clearAll()
    const { x, y } = pointer
    // read phase: every rect first, no writes in between (no layout thrash)
    const hits: { el: HTMLElement; lx: number; ly: number; li: number }[] = []
    for (const el of doc.querySelectorAll<HTMLElement>(GLASS_SELECTOR)) {
      const r = el.getBoundingClientRect()
      const li = lightIntensity(rectDistance(x, y, r), radius)
      if (li > 0) hits.push({ el, lx: x - r.left, ly: y - r.top, li })
    }
    // write phase
    const next = new Set<HTMLElement>()
    for (const { el, lx, ly, li } of hits) {
      el.setAttribute('data-glass-lit', '')
      el.style.setProperty('--lx', `${lx.toFixed(1)}px`); el.style.setProperty('--ly', `${ly.toFixed(1)}px`)
      el.style.setProperty('--li', li.toFixed(3))
      next.add(el)
    }
    for (const el of lit) if (!next.has(el)) clear(el)
    lit.clear(); for (const el of next) lit.add(el)
  }
  const schedule = () => { if (frame === null) frame = raf(update) }

  const onMove = (e: PointerEvent | MouseEvent) => {
    if ((e as PointerEvent).pointerType === 'touch') return
    pointer = { x: e.clientX, y: e.clientY }
    schedule()
  }
  const stop = () => { pointer = null; if (frame !== null) cancel(frame); frame = null; clearAll() }
  const onVisibility = () => { if (doc.hidden) stop() }
  // menus and modals appear under a resting pointer: re-evaluate when body children change
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (pointer) schedule() }) : null
  mo?.observe(doc.body, { childList: true })

  // over the window's drag area (the header) the page gets no mouse events; the main process then sends the position
  const onRemote = (e: Event) => {
    const p = (e as CustomEvent<{ x: number; y: number } | null>).detail
    if (!p) return stop()
    pointer = p
    schedule()
  }
  win.addEventListener('pointermove', onMove, { passive: true })
  win.addEventListener('aether:pointer', onRemote)
  win.addEventListener('blur', stop)
  doc.addEventListener('visibilitychange', onVisibility)
  doc.documentElement.addEventListener('mouseleave', stop)
  return () => {
    win.removeEventListener('pointermove', onMove)
    win.removeEventListener('aether:pointer', onRemote)
    win.removeEventListener('blur', stop)
    doc.removeEventListener('visibilitychange', onVisibility)
    doc.documentElement.removeEventListener('mouseleave', stop)
    mo?.disconnect()
    stop()
  }
}
