import { useEffect, useRef, useState } from 'react'
import { dismissToast, onToast, type ToastSpec } from '../features/toast'
import { announce } from '../features/announce'
import './Toast.css'

/** Bottom toast (above the dock). Hover / focus pauses the timer, so there is always time to press "Undo". */
export function Toast() {
  const [t, setT] = useState<ToastSpec | null>(null)
  const [paused, setPaused] = useState(false)
  const left = useRef(0)
  const started = useRef(0)
  useEffect(() => onToast((n) => {
    setT(n)
    setPaused(false)
    left.current = n?.ms ?? 0
    if (n) announce(n.action ? `${n.text}. ${n.action.label}` : n.text)
  }), [])
  useEffect(() => {
    if (!t || paused || !left.current) return
    started.current = Date.now()
    const id = window.setTimeout(() => dismissToast(t, true), left.current)
    return () => {
      window.clearTimeout(id)
      left.current = Math.max(800, left.current - (Date.now() - started.current))
    }
  }, [t, paused])
  if (!t) return null
  return (
    <div
      className={`app-toast is-${t.kind ?? 'info'}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="app-toast__text">{t.text}</span>
      {t.action && (
        <button
          className="app-toast__action"
          onClick={() => {
            dismissToast(t, false)
            t.action!.run()
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="app-toast__close" aria-label="×" onClick={() => dismissToast(t, true)}>
        <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
