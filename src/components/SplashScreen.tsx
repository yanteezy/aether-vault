import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo-ribbon.png'
import './SplashScreen.css'

/**
 * Launch splash (Concept 3 — Liquid Infinity Ribbon).
 * Phases (CSS keyframes, 1150ms total): spring entry 0–420ms → caustic pulse (aura + ribbon glow, no white gloss)
 * 380–820ms → dissolve into the canvas 820–1150ms; unmounted at 1180ms.
 * The app renders underneath from the start, so nothing waits for the splash.
 * Click / any key skips it. prefers-reduced-motion → 150ms fade without zoom.
 */

const TOTAL_MS = 1180
const REDUCED_MS = 150
const SKIP_FADE_MS = 150
const SESSION_KEY = 'aether:splash-shown'

/** Show once per app session (a reload during the same launch does not replay it). */
export function shouldShowSplash(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== '1'
  } catch {
    return true
  }
}

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [skipping, setSkipping] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  const skipRef = useRef<() => void>(() => {})

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let timer = window.setTimeout(() => doneRef.current(), reduce ? REDUCED_MS : TOTAL_MS)

    let skipped = false
    const skip = () => {
      if (skipped) return
      skipped = true
      window.clearTimeout(timer)
      setSkipping(true)
      timer = window.setTimeout(() => doneRef.current(), SKIP_FADE_MS)
    }
    skipRef.current = skip
    const onKey = (e: KeyboardEvent) => {
      // swallow the skipping key so it does not also fire a shortcut on the canvas
      e.preventDefault()
      e.stopImmediatePropagation()
      skip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  return (
    <div
      className={`splash${skipping ? ' is-skipping' : ''}`}
      role="presentation"
      aria-hidden="true"
      onPointerDown={() => skipRef.current()}
    >
      <div className="splash__stage">
        <div className="splash__aura" />
        <div className="splash__logo">
          <img src={logo} alt="" draggable={false} />
        </div>
        <div className="splash__wordmark">AETHER</div>
      </div>
    </div>
  )
}
