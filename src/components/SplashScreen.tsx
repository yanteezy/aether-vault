import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo-ribbon.png'
import { useT } from '../i18n'
import { collectUiRects, createSplash, SPLASH_RELEASE, SPLASH_TOTAL, SPLASH_VARIANTS, type SplashVariant, type UiRect } from './splash/infinitySplash'
import { createDockSplash, DOCK_RELEASE, DOCK_TOTAL } from './splash/dockSplash'
import './SplashScreen.css'

/**
 * Launch splash. Default ('dock', splash/dockSplash.ts): a light traces the ∞ around the logo while the app loads,
 * then unfolds into the bottom dock and lifts off the interface.
 * Alternatives ('vortex' · 'wave' · 'threads', splash/infinitySplash.ts): a procedural glass ∞ (Canvas 2D, see splash/infinitySplash.ts) that comes alive,
 * peels into light and particles and dissolves into the interface rendered underneath it.
 * 0–0.6s assembled logo · 0.6–2.2s flows run and segments roll · 2.2–3.5s release into the UI.
 * From 2.2s the layer lets clicks through; at 3.5s it unmounts. Click / any key skips it.
 * prefers-reduced-motion → a still logo and a short fade.
 *
 * Variant: localStorage `aether:splash-variant` = 'dock' | 'vortex' | 'wave' | 'threads' to compare.
 */

const REDUCED_MS = 450
const SKIP_FADE_MS = 200
const SESSION_KEY = 'aether:splash-shown'
/** The full animation plays on the first launch of the day; later launches get a 0.6 s fade. */
const DAY_KEY = 'aether:splash-day'
const today = () => new Date().toISOString().slice(0, 10)
function seenToday() {
  try {
    return localStorage.getItem(DAY_KEY) === today()
  } catch {
    return false
  }
}
const VARIANT_KEY = 'aether:splash-variant'
type Variant = SplashVariant | 'dock'
export const DEFAULT_SPLASH_VARIANT: Variant = 'dock'

/** Show once per app session (a reload during the same launch does not replay it). */
export function shouldShowSplash(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== '1'
  } catch {
    return true
  }
}

function pickVariant(): Variant {
  try {
    const v = localStorage.getItem(VARIANT_KEY) as Variant | null
    if (v && (v === 'dock' || SPLASH_VARIANTS.includes(v))) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_SPLASH_VARIANT
}

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const tr = useT()
  const trRef = useRef(tr)
  trRef.current = tr
  const [variant] = useState(pickVariant)
  const [quick] = useState(seenToday)
  const [skipping, setSkipping] = useState(false)
  const logoRef = useRef<HTMLImageElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  const skipRef = useRef<() => void>(() => {})

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
      localStorage.setItem(DAY_KEY, today())
    } catch {
      /* ignore */
    }
    if (quick) return // the short fade is pure CSS (see render)
    const host = hostRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!host || !canvas || !ctx) {
      doneRef.current()
      return
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dockMode = variant === 'dock' && !!logoRef.current
    const total = dockMode ? DOCK_TOTAL : SPLASH_TOTAL
    const release = dockMode ? DOCK_RELEASE : SPLASH_RELEASE
    const dockRenderer = dockMode && logoRef.current ? createDockSplash(ctx, logoRef.current, (k) => trRef.current(k)) : null
    const renderer = variant === 'dock' ? null : createSplash(ctx, variant)
    const readDock = (): UiRect | null => {
      const el = document.querySelector('.command-dock')
      if (!el) return null
      const b = el.getBoundingClientRect()
      if (b.width < 40) return null
      return { x: b.left, y: b.top, w: b.width, h: b.height, r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 22 }
    }
    let dockRect: UiRect | null = null
    const draw = (t: number) => {
      if (dockRenderer) dockRenderer.draw(t, W, H, dockRect)
      else renderer?.draw(t, W, H, targets ?? [])
    }

    let W = 0
    let H = 0
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    window.addEventListener('resize', fit)

    let targets: UiRect[] | null = null
    let finished = false
    let raf = 0
    let timer = 0
    const finish = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      doneRef.current()
    }

    let start: number | null = null
    const frame = (now: number) => {
      if (start == null) start = now
      const t = (now - start) / 1000
      // the interface's layout is read just before it is needed (the dock: again before the morph, in case it moved)
      if (dockRenderer && (!dockRect || (t >= 2.7 && t < 2.8))) dockRect = readDock() ?? dockRect
      if (!dockRenderer && !targets && t >= SPLASH_RELEASE - 0.1) targets = collectUiRects(W, H)
      draw(t)
      if (t >= release) host.style.pointerEvents = 'none'
      if (t >= total) return finish()
      raf = requestAnimationFrame(frame)
    }
    if (reduce) {
      draw(0.6)
      timer = window.setTimeout(() => {
        setSkipping(true)
        timer = window.setTimeout(finish, SKIP_FADE_MS)
      }, REDUCED_MS)
    } else raf = requestAnimationFrame(frame)

    let skipped = false
    const skip = () => {
      if (skipped || finished) return
      skipped = true
      setSkipping(true)
      timer = window.setTimeout(finish, SKIP_FADE_MS)
    }
    skipRef.current = skip
    const onKey = (e: KeyboardEvent) => {
      if (finished || host.style.pointerEvents === 'none') return
      // swallow the skipping key so it does not also fire a shortcut on the canvas
      e.preventDefault()
      e.stopImmediatePropagation()
      skip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', fit)
    }
  }, [variant, quick])

  if (quick)
    return (
      <div className="splash splash--quick" role="presentation" aria-hidden="true" onAnimationEnd={(e) => e.target === e.currentTarget && doneRef.current()}>
        <img className="splash__quick-logo" src={logo} alt="" draggable={false} />
      </div>
    )

  return (
    <div
      ref={hostRef}
      className={`splash${skipping ? ' is-skipping' : ''}`}
      role="presentation"
      aria-hidden="true"
      onPointerDown={() => skipRef.current()}
    >
      <canvas ref={canvasRef} className="splash__canvas" />
      {variant === 'dock' && <img ref={logoRef} className="splash__logo" src={logo} alt="" draggable={false} />}
    </div>
  )
}
