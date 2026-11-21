/**
 * Regular launch ("dock" variant, the default): the logo sits in the middle while a light traces the ∞ around it
 * with the loading progress; then the light unfolds into the outline of the real bottom dock, the dock shows
 * through it, the logo sinks into the dock and the canvas with the notes is revealed.
 * Timeline (s): 0–0.6 logo in · 0.4–2.6 tracing + progress · 2.8–3.7 light → dock, logo → dock ·
 * 3.35–3.75 dock shows through · 3.55–4.1 the veil lifts over the rest of the interface.
 */
import { drawLight, drawStatus, eio, eob, halo, lemniscate, lerp, placeLogo, progress, roundRectPts, seg, type P } from './trace'
import type { UiRect } from './infinitySplash'

export const DOCK_TOTAL = 4.1
export const DOCK_RELEASE = 3.55
const STAGES = ['Відкриваємо сховище', 'Готуємо полотно', 'Прогріваємо рендер', 'Майже готово']

export function createDockSplash(ctx: CanvasRenderingContext2D, logo: HTMLImageElement, tr: (s: string) => string) {
  return {
    /** `dock` = the dock's rect in CSS px (null → a stand-in bar at the bottom centre). */
    draw(t: number, W: number, H: number, dock: UiRect | null) {
      const d: UiRect = dock ?? { x: W / 2 - 300, y: H - 92, w: 600, h: 64, r: 22 }
      const cx = W / 2
      const cy = H / 2
      const a = Math.min(W * 0.2, H * 0.32, 250)
      const intro = eob(seg(t, 0, 0.6))
      const p = progress(t, 0.4, 2.6)
      const m = eio(seg(t, 2.8, 3.7))
      const veil = 1 - seg(t, 3.55, 4.1)

      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, W, H)
      if (veil > 0) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.6)
        g.addColorStop(0, '#141724')
        g.addColorStop(1, '#090a10')
        ctx.globalAlpha = veil
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
        // the real dock shows through the light's outline
        const show = seg(t, 3.35, 3.75)
        if (show > 0) {
          ctx.globalCompositeOperation = 'destination-out'
          ctx.globalAlpha = show
          ctx.fillStyle = '#000'
          ctx.beginPath()
          ctx.roundRect(d.x, d.y, d.w, d.h, d.r)
          ctx.fill()
          ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = 1
      }

      // logo: centre → sinks into the dock (towards its search field) and dissolves there
      const tx = d.x + Math.min(48, d.w * 0.08)
      const ty = d.y + d.h / 2
      const lx = lerp(cx, tx, m)
      const ly = lerp(cy, ty, m)
      const ls = lerp(Math.min(230, a * 0.95), d.h * 0.55, m) * lerp(0.8, 1, intro) * (1 + 0.02 * Math.sin(t * 3) * (1 - m))
      halo(ctx, lx, ly, ls * 1.4, intro * (1 - seg(t, 3.3, 3.7)), W, H)

      const lem = lemniscate(cx, cy, a)
      const box = roundRectPts(d.x, d.y, d.w, d.h, d.r)
      const pts = m > 0 ? lem.map((q, i) => [lerp(q[0], box[i][0], m), lerp(q[1], box[i][1], m)] as P) : lem
      drawLight(ctx, pts, m > 0 ? pts.length : Math.floor(p * (pts.length - 1)), cx, a, 0.95 * (1 - seg(t, 3.55, 3.95)), lerp(2.5, 1.6, m), m > 0.98, m === 0)
      drawStatus(ctx, tr(STAGES[Math.min(3, Math.floor(p * 4))]), p, cx, cy + a * 0.62 + 40, (1 - seg(t, 2.55, 2.85)) * seg(t, 0.4, 0.8))
      placeLogo(logo, lx, ly, ls, intro * (1 - seg(t, 3.35, 3.7)), -0.04 * (1 - m))
    },
  }
}
