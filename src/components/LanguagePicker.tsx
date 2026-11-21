import { useLayoutEffect, useRef, useState } from 'react'
import logo from '../assets/logo-ribbon.png'
import { systemLang, type Lang } from '../i18n'
import { drawLight, drawStatus, eio, eob, halo, lemniscate, lerp, placeLogo, progress, roundRectPts, seg, type P } from './splash/trace'
import './LanguagePicker.css'

/**
 * First launch: an intro (a light traces the ∞ around the logo while the app loads, then the logo glides up
 * to the top of the card and the light unfolds into the card's outline), then the language question.
 * Written in both languages on purpose. Click / any key skips the intro; reduced motion shows the card at once.
 */

const INTRO_END = 4.4

export function LanguagePicker({ onPick }: { onPick: (lang: Lang) => void }) {
  const [hover, setHover] = useState<Lang>(systemLang())
  const [phase, setPhase] = useState<'intro' | 'reveal' | 'done'>(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'done' : 'intro',
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const flyRef = useRef<HTMLImageElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLImageElement>(null)
  const skipRef = useRef<() => void>(() => {})
  const options: { id: Lang; name: string; action: string; code: string }[] = [
    { id: 'en', name: 'English', action: 'Continue in English', code: 'EN' },
    { id: 'uk', name: 'Українська', action: 'Продовжити українською', code: 'UA' },
  ]

  useLayoutEffect(() => {
    if (phase === 'done') return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const fly = flyRef.current
    const card = cardRef.current
    const slot = slotRef.current
    if (!canvas || !ctx || !fly || !card || !slot) return
    let W = 0
    let H = 0
    let cardBox: DOMRect = card.getBoundingClientRect()
    let slotBox: DOMRect = slot.getBoundingClientRect()
    let radius = 24
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cardBox = card.getBoundingClientRect()
      slotBox = slot.getBoundingClientRect()
      radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 24
    }
    fit()
    window.addEventListener('resize', fit)

    let start: number | null = null
    let raf = 0
    let revealed = false
    let offset = 0 // skipping jumps the clock forward to the morph
    const draw = (now: number) => {
      if (start == null) start = now
      const t = (now - start) / 1000 + offset
      const cx = W / 2
      const cy = H / 2
      const intro = eob(seg(t, 0, 0.6))
      const p = progress(t, 0.4, 2.8)
      const m = eio(seg(t, 3.0, 4.0))
      const a = Math.min(W * 0.2, H * 0.32, 250)
      ctx.clearRect(0, 0, W, H)
      const lx = lerp(cx, slotBox.left + slotBox.width / 2, m)
      const ly = lerp(cy, slotBox.top + slotBox.height / 2, m)
      const ls = lerp(Math.min(230, a * 0.95), slotBox.width, m) * lerp(0.8, 1, intro) * (1 + 0.02 * Math.sin(t * 3) * (1 - m))
      halo(ctx, lx, ly, ls * 1.4, intro, W, H)
      // the light traces the ∞ with the progress, then unfolds into the card's outline
      const lem = lemniscate(cx, cy, a)
      const box = roundRectPts(cardBox.left, cardBox.top, cardBox.width, cardBox.height, radius)
      const pts = m > 0 ? lem.map((q, i) => [lerp(q[0], box[i][0], m), lerp(q[1], box[i][1], m)] as P) : lem
      drawLight(ctx, pts, m > 0 ? pts.length : Math.floor(p * (pts.length - 1)), cx, a, 0.95 * (1 - seg(t, 3.8, 4.3)), lerp(2.5, 1.4, m), m > 0.98, m === 0)
      drawStatus(ctx, 'Preparing your space · Готуємо простір', p, cx, cy + a * 0.62 + 40, (1 - seg(t, 2.75, 3.05)) * seg(t, 0.4, 0.8))
      placeLogo(fly, lx, ly, ls, intro, -0.04 * (1 - m))

      if (!revealed && t >= 3.65) {
        revealed = true
        setPhase('reveal')
      }
      if (t >= INTRO_END) {
        setPhase('done')
        return
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    skipRef.current = () => {
      if (start == null) return
      const t = (performance.now() - start) / 1000 + offset
      if (t < 3.0) offset += 3.0 - t
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      skipRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', onKey, true)
    }
    // the intro runs once; later phase changes only reveal the card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`lang-pick is-${phase}`}
      role="dialog"
      aria-label="Choose your language · Оберіть мову"
      onPointerDown={() => phase === 'intro' && skipRef.current()}
    >
      <div className="lang-pick__card" ref={cardRef}>
        <img className="lang-pick__logo" ref={slotRef} src={logo} alt="" />
        <h1 className="lang-pick__title">Welcome to Aether</h1>
        <p className="lang-pick__subtitle">Choose your language · Оберіть мову</p>
        <div className="lang-pick__options">
          {options.map((o) => (
            <button
              key={o.id}
              className={`lang-pick__option${hover === o.id ? ' is-suggested' : ''}`}
              tabIndex={phase === 'intro' ? -1 : 0}
              onMouseEnter={() => setHover(o.id)}
              onFocus={() => setHover(o.id)}
              onClick={() => onPick(o.id)}
            >
              <span className="lang-pick__code">{o.code}</span>
              <span className="lang-pick__name">{o.name}</span>
              <span className="lang-pick__action">{o.action} →</span>
            </button>
          ))}
        </div>
        <p className="lang-pick__note">You can change it later in Settings · Змінити можна в налаштуваннях</p>
      </div>
      {phase !== 'done' && (
        <>
          <canvas className="lang-pick__intro" ref={canvasRef} aria-hidden="true" />
          <img className="lang-pick__fly" ref={flyRef} src={logo} alt="" aria-hidden="true" draggable={false} />
        </>
      )}
    </div>
  )
}
