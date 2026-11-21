/** Shared bits of the "light traces the ∞" intros (first launch and regular launch). */
export type P = [number, number]

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
export const eio = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
export const eob = (u: number) => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2)
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Loading progress with a little irregularity, 0..1 between a and b. */
export function progress(t: number, a: number, b: number) {
  const u = seg(t, a, b)
  return clamp(u + 0.05 * Math.sin(u * 9) * (1 - u))
}

/** Resample a polyline into n points evenly spaced along its length (so two shapes can morph point-to-point). */
export function resample(pts: P[], n: number): P[] {
  const len = [0]
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = len[len.length - 1]
  const out: P[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const d = (k / n) * total
    while (j < len.length - 2 && len[j + 1] < d) j++
    const f = (d - len[j]) / (len[j + 1] - len[j] || 1)
    out.push([lerp(pts[j][0], pts[j + 1][0], f), lerp(pts[j][1], pts[j + 1][1], f)])
  }
  return out
}

/** The ∞ (lemniscate of Bernoulli), slightly tilted like the logo; starts at its right tip. */
export function lemniscate(cx: number, cy: number, a: number, n = 600): P[] {
  const raw: P[] = []
  for (let i = 0; i <= 1600; i++) {
    const u = (i / 1600) * Math.PI * 2
    const s = Math.sin(u)
    const d = 1 + s * s
    const x = (a * Math.cos(u)) / d
    const y = ((a * s * Math.cos(u)) / d) * 1.25
    raw.push([cx + x * Math.cos(-0.3) - y * Math.sin(-0.3), cy + x * Math.sin(-0.3) + y * Math.cos(-0.3)])
  }
  return resample(raw, n)
}

/** Outline of a rounded rect; starts at the right-middle, like the ∞. */
export function roundRectPts(x: number, y: number, w: number, h: number, r: number, n = 600): P[] {
  r = Math.min(r, w / 2, h / 2)
  const raw: P[] = []
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i <= 20; i++) raw.push([lerp(x0, x1, i / 20), lerp(y0, y1, i / 20)])
  }
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 20; i++) raw.push([cx + Math.cos(a0 + (i / 20) * (Math.PI / 2)) * r, cy + Math.sin(a0 + (i / 20) * (Math.PI / 2)) * r])
  }
  line(x + w, y + h / 2, x + w, y + h - r)
  arc(x + w - r, y + h - r, 0)
  line(x + w - r, y + h, x + r, y + h)
  arc(x + r, y + h - r, Math.PI / 2)
  line(x, y + h - r, x, y + r)
  arc(x + r, y + r, Math.PI)
  line(x + r, y, x + w - r, y)
  arc(x + w - r, y + r, -Math.PI / 2)
  line(x + w, y + r, x + w, y + h / 2)
  return resample(raw, n)
}

/** Soft cyan/violet glow behind the logo. */
export function halo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, W: number, H: number) {
  if (a <= 0) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(34,211,238,${0.22 * a})`)
  g.addColorStop(0.5, `rgba(192,132,252,${0.14 * a})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/** The light: the first `upto` points of `pts`, glowing cyan → violet; a bright head while it is still tracing. */
export function drawLight(ctx: CanvasRenderingContext2D, pts: P[], upto: number, cx: number, a: number, alpha: number, width: number, closed: boolean, head: boolean) {
  if (upto < 2 || alpha <= 0) return
  const g = ctx.createLinearGradient(cx - a, 0, cx + a, 0)
  g.addColorStop(0, `rgba(34,211,238,${alpha})`)
  g.addColorStop(1, `rgba(192,132,252,${alpha})`)
  ctx.save()
  ctx.strokeStyle = g
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = `rgba(34,211,238,${alpha * 0.8})`
  ctx.shadowBlur = 16
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < upto; i++) ctx.lineTo(pts[i][0], pts[i][1])
  if (closed) ctx.closePath()
  ctx.stroke()
  if (head) {
    const h = pts[upto - 1]
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgb(34,211,238)'
    ctx.shadowBlur = 20
    ctx.beginPath()
    ctx.arc(h[0], h[1], 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Status line + percent under the logo. */
export function drawStatus(ctx: CanvasRenderingContext2D, text: string, p: number, x: number, y: number, a: number) {
  if (a <= 0) return
  ctx.save()
  ctx.globalAlpha = a
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '400 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif'
  ctx.fillStyle = '#a8abbd'
  ctx.fillText(text, x, y)
  ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif'
  ctx.fillStyle = 'rgb(34,211,238)'
  ctx.fillText(`${Math.round(p * 100)}%`, x, y + 26)
  ctx.restore()
}

/** Place the real <img> logo (kept as an element so it stays sharp). */
export function placeLogo(img: HTMLImageElement, x: number, y: number, size: number, alpha: number, rot = 0) {
  img.style.opacity = String(alpha)
  img.style.width = img.style.height = `${size}px`
  img.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${rot}rad)`
}
