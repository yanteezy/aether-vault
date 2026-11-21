/**
 * Procedural launch animation: a glass Möbius-like ∞ ribbon drawn on Canvas 2D (no images, no WebGL).
 *
 * Decomposition of the logo:
 *  - centre line: a 3D lemniscate (the two loops sit at different depths, so the ribbon passes over itself
 *    at the crossing), tilted and seen in perspective;
 *  - glass ribbon: ~420 quads along that line, twisted 1.5 turns (a Möbius strip); every quad gets its own
 *    normal → front faces cyan, back faces violet, edge-on faces give silver rims and specular glints;
 *  - cyan core: a bright vein in the middle of the ribbon with light pulses running along the ∞;
 *  - violet streams: two translucent strands winding around the core;
 *  - particles: 520 sparks bound to the curve, released in the last phase.
 *
 * Timeline (seconds): 0–0.6 the assembled logo · 0.6–2.2 flows run, segments roll and peel apart,
 * particles speed up · 2.2–3.5 everything leaves the curve and dissolves into the real interface underneath
 * (the splash cuts card-shaped windows into its own background where the UI's notes, top bar and dock are).
 */

export type SplashVariant = 'vortex' | 'wave' | 'threads'
export const SPLASH_VARIANTS: SplashVariant[] = ['vortex', 'wave', 'threads']
export const SPLASH_TOTAL = 3.5
export const SPLASH_RELEASE = 2.2

type V3 = [number, number, number]
type P2 = [number, number]
export interface UiRect {
  x: number
  y: number
  w: number
  h: number
  r: number
}

const N = 420
const CHUNKS = 18
const PARTICLES = 520
const TWIST = 1.5

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const eio = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const eo = (u: number) => 1 - Math.pow(1 - u, 3)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const bump = (u: number) => Math.sin(Math.PI * clamp(u))
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Tiny deterministic PRNG, so every launch (and every recorded frame) looks the same. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ---------- static geometry (model space) ----------
const CENTRE: V3[] = []
const TAN: V3[] = []
const NRM: V3[] = []
const BIN: V3[] = []
for (let i = 0; i < N; i++) {
  const v = (i / N) * Math.PI * 2
  const s = Math.sin(v)
  const d = 1 + s * s
  CENTRE.push([Math.cos(v) / d, (1.35 * s * Math.cos(v)) / d, 0.3 * s])
}
for (let i = 0; i < N; i++) {
  const a = CENTRE[(i + N - 1) % N]
  const b = CENTRE[(i + 1) % N]
  const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
  const n = norm(cross(t, [0, 0, 1]))
  TAN.push(t)
  NRM.push(n)
  BIN.push(cross(t, n))
}

const CYAN: V3 = [34, 211, 238]
const SKY: V3 = [56, 189, 248]
const VIOLET: V3 = [139, 92, 246]
const INDIGO: V3 = [99, 102, 241]
const PURPLE: V3 = [168, 85, 247]
const mixc = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
const rgba = (c: V3, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`

interface Particle {
  u: number
  off: number
  push: number
  spd: number
  size: number
  col: V3
  delay: number
  tx: number
  ty: number
  swirl: number
}

export interface SplashRenderer {
  /** Draw the frame at time t (s). `targets` = rects of the interface under the splash, in CSS px. */
  draw(t: number, w: number, h: number, targets: UiRect[]): void
}

export function createSplash(ctx: CanvasRenderingContext2D, variant: SplashVariant): SplashRenderer {
  const rand = rng(7)
  const parts: Particle[] = Array.from({ length: PARTICLES }, () => {
    const r = rand()
    return {
      u: rand(),
      off: (rand() * 2 - 1) * (rand() < 0.6 ? 0.6 : 1.25),
      push: rand() * 2 - 1,
      spd: 0.6 + rand() * 0.9,
      size: 0.7 + rand() * rand() * 2.2,
      col: r < 0.45 ? (rand() < 0.5 ? CYAN : SKY) : r < 0.85 ? (rand() < 0.5 ? VIOLET : PURPLE) : ([235, 240, 255] as V3),
      delay: rand(),
      tx: rand(),
      ty: rand(),
      swirl: rand() < 0.5 ? -1 : 1,
    }
  })
  const chunkJitter = Array.from({ length: CHUNKS }, () => [rand() * 2 - 1, rand() * 2 - 1, rand()])

  // per-frame buffers
  const c2 = new Float32Array(N * 2)
  const e1 = new Float32Array(N * 2)
  const e2 = new Float32Array(N * 2)
  const depth = new Float32Array(N)
  const face = new Float32Array(N)
  const order = Array.from({ length: N }, (_, i) => i)

  /** Distance travelled along the ∞ by a particle of speed 1 (integral of the speed ramp). */
  const travel = (t: number) => {
    let acc = 0
    const steps = 24
    for (let k = 0; k < steps; k++) {
      const tt = (t * (k + 0.5)) / steps
      acc += (0.03 + 0.3 * eio(seg(tt, 0.6, 2.2)) + 0.25 * seg(tt, 2.2, 3)) * (t / steps)
    }
    return acc
  }

  return {
    draw(t, W, H, targets) {
      const cx = W / 2
      const cy = H * 0.47
      const S = Math.min(W * 0.17, H * 0.27)
      const D = 3.4
      const intro = eo(seg(t, 0, 0.45))
      const live = seg(t, 0.6, 2.2) // phase 2 progress
      const sep = eio(seg(t, 1.25, 2.2)) // peeling apart
      const out = eio(seg(t, SPLASH_RELEASE, 3.1)) // phase 3 progress for the ribbon
      const spin = 0.35 * t + 2.2 * travel(t) // segments roll around their own axis
      const ry = 0.28 + 0.07 * Math.sin(t * 1.1)
      const rx = 0.55
      const rz = -0.42
      const [sX, cX, sY, cY, sZ, cZ] = [Math.sin(rx), Math.cos(rx), Math.sin(ry), Math.cos(ry), Math.sin(rz), Math.cos(rz)]
      const rot = (p: V3): V3 => {
        // Y, then X, then Z
        const x1 = p[0] * cY + p[2] * sY
        const z1 = -p[0] * sY + p[2] * cY
        const y2 = p[1] * cX - z1 * sX
        const z2 = p[1] * sX + z1 * cX
        return [x1 * cZ - y2 * sZ, x1 * sZ + y2 * cZ, z2]
      }
      const scale = lerp(0.92, 1, intro) * (1 + 0.012 * Math.sin(t * 2.4))
      const proj = (p: V3, o: number) => {
        const k = D / (D - p[2])
        e1[o] = cx + p[0] * k * S * scale
        e1[o + 1] = cy + p[1] * k * S * scale
      }

      // ---------- geometry for this frame ----------
      for (let i = 0; i < N; i++) {
        const v = (i / N) * Math.PI * 2
        const th = TWIST * v + spin
        const wv: V3 = [
          NRM[i][0] * Math.cos(th) + BIN[i][0] * Math.sin(th),
          NRM[i][1] * Math.cos(th) + BIN[i][1] * Math.sin(th),
          NRM[i][2] * Math.cos(th) + BIN[i][2] * Math.sin(th),
        ]
        const hw = 0.19 * (1 + 0.12 * Math.sin(3 * v))
        const p = CENTRE[i]
        const pc = rot(p)
        const pa = rot([p[0] + wv[0] * hw, p[1] + wv[1] * hw, p[2] + wv[2] * hw])
        const pb = rot([p[0] - wv[0] * hw, p[1] - wv[1] * hw, p[2] - wv[2] * hw])
        const kc = D / (D - pc[2])
        c2[i * 2] = cx + pc[0] * kc * S * scale
        c2[i * 2 + 1] = cy + pc[1] * kc * S * scale
        proj(pa, i * 2)
        const ax = e1[i * 2]
        const ay = e1[i * 2 + 1]
        proj(pb, i * 2)
        e2[i * 2] = e1[i * 2]
        e2[i * 2 + 1] = e1[i * 2 + 1]
        e1[i * 2] = ax
        e1[i * 2 + 1] = ay
        depth[i] = pc[2]
        face[i] = norm(cross(rot(TAN[i]), rot(wv)))[2]
      }

      // chunk centroids (screen) → peel / phase-3 transforms
      const chC = new Float32Array(CHUNKS * 2)
      for (let i = 0; i < N; i++) {
        const c = Math.floor((i * CHUNKS) / N)
        chC[c * 2] += c2[i * 2] / (N / CHUNKS)
        chC[c * 2 + 1] += c2[i * 2 + 1] / (N / CHUNKS)
      }
      const chunkXf = (c: number, x: number, y: number): P2 => {
        const j = chunkJitter[c]
        const ox = chC[c * 2] - cx
        const oy = chC[c * 2 + 1] - cy
        const ol = Math.hypot(ox, oy) || 1
        // phase 2: chunks drift a little away from the centre
        x += (ox / ol) * sep * (10 + 14 * j[2]) + j[0] * sep * 6
        y += (oy / ol) * sep * (10 + 14 * j[2]) + j[1] * sep * 6
        if (out <= 0) return [x, y]
        if (variant === 'vortex') {
          const a = out * (1.3 + 0.5 * j[2])
          const r = 1 + out * (2.4 + 1.5 * j[2])
          const dx = (x - cx) * r
          const dy = (y - cy) * r
          return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]
        }
        if (variant === 'wave') {
          const r = 1 + out * (4 + 2 * j[2])
          return [cx + (x - cx) * r, cy + (y - cy) * r]
        }
        // threads: chunks pull into their centre while their light runs off as threads
        const k = 1 - out
        return [chC[c * 2] + (x - chC[c * 2]) * k, chC[c * 2 + 1] + (y - chC[c * 2 + 1]) * k]
      }

      // ---------- background (and windows onto the interface) ----------
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, W, H)
      const bgA =
        variant === 'wave' ? 1 - seg(t, 3.05, 3.45) : variant === 'threads' ? 1 - seg(t, 3.0, 3.45) : 1 - seg(t, 2.95, 3.45)
      if (bgA > 0) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.6)
        g.addColorStop(0, '#26293A')
        g.addColorStop(1, '#161822')
        ctx.globalAlpha = bgA
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
        // soft halo behind the logo
        const ha = (0.5 + 0.5 * intro) * (1 - out)
        if (ha > 0) {
          const h = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 2.1)
          h.addColorStop(0, rgba(CYAN, 0.16 * ha))
          h.addColorStop(0.45, rgba(VIOLET, 0.1 * ha))
          h.addColorStop(1, rgba(VIOLET, 0))
          ctx.globalAlpha = 1
          ctx.fillStyle = h
          ctx.fillRect(0, 0, W, H)
        }
      }
      const maxD = Math.hypot(W, H) * 0.6
      const waveR = eo(seg(t, SPLASH_RELEASE, 3.2)) * maxD * 1.15
      const reveal = targets.map((r, i) => {
        const dx = r.x + r.w / 2 - cx
        const dy = r.y + r.h / 2 - cy
        const d = Math.hypot(dx, dy) / maxD
        if (variant === 'wave') return seg(waveR, Math.hypot(dx, dy) - 60, Math.hypot(dx, dy) + 140)
        if (variant === 'threads') {
          const s0 = SPLASH_RELEASE + (i / Math.max(1, targets.length)) * 0.35
          return seg(t, s0 + 0.55, s0 + 0.85)
        }
        return seg(t, 2.55 + d * 0.4, 2.95 + d * 0.4)
      })
      if (bgA > 0) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = '#000'
        targets.forEach((r, i) => {
          if (reveal[i] <= 0) return
          ctx.globalAlpha = reveal[i]
          ctx.beginPath()
          ctx.roundRect(r.x, r.y, r.w, r.h, r.r)
          ctx.fill()
        })
        if (variant === 'wave' && waveR > 0) {
          const g = ctx.createRadialGradient(cx, cy, Math.max(0, waveR - 160), cx, cy, waveR)
          g.addColorStop(0, 'rgba(0,0,0,1)')
          g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.globalAlpha = 1
          ctx.fillStyle = g
          ctx.fillRect(0, 0, W, H)
        }
        ctx.globalCompositeOperation = 'source-over'
      }

      // ---------- glass ribbon ----------
      const ribbonA = intro * lerp(1, 0.8, live) * (1 - out)
      if (ribbonA > 0.01) {
        order.sort((a, b) => depth[a] - depth[b])
        const flowPhase = travel(t) * 9
        for (const i of order) {
          const j = (i + 1) % N
          const c = Math.floor((i * CHUNKS) / N)
          const q = ((i * CHUNKS) / N) % 1
          if (q < sep * 0.32 && sep > 0.02) continue // gaps between peeled segments
          const v = (i / N) * Math.PI * 2
          const f = face[i]
          const af = Math.abs(f)
          const flow = 0.5 + 0.5 * Math.sin(v * 3 - flowPhase)
          const col = f >= 0 ? mixc(CYAN, SKY, flow) : mixc(mixc(VIOLET, INDIGO, flow), PURPLE, 0.5 - 0.5 * Math.sin(v * 2 + t))
          const tint = mixc(col, [235, 245, 255], 0.15 * Math.pow(1 - af, 2))
          const [ax, ay] = chunkXf(c, e1[i * 2], e1[i * 2 + 1])
          const [bx, by] = chunkXf(c, e1[j * 2], e1[j * 2 + 1])
          const [ccx, ccy] = chunkXf(c, e2[j * 2], e2[j * 2 + 1])
          const [dx, dy] = chunkXf(c, e2[i * 2], e2[i * 2 + 1])
          const a = ribbonA * (0.26 + 0.42 * Math.pow(af, 0.7))
          ctx.globalAlpha = 1
          ctx.fillStyle = rgba(tint, a)
          ctx.strokeStyle = rgba(tint, a * 0.6)
          ctx.lineWidth = 0.6
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(bx, by)
          ctx.lineTo(ccx, ccy)
          ctx.lineTo(dx, dy)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
          // silver rims: brightest where the strip turns edge-on
          const rim = 0.16 + 0.75 * Math.pow(1 - af, 4)
          ctx.strokeStyle = `rgba(255,255,255,${(ribbonA * rim * 0.75).toFixed(3)})`
          ctx.lineWidth = 1.1
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(bx, by)
          ctx.moveTo(dx, dy)
          ctx.lineTo(ccx, ccy)
          ctx.stroke()
          // specular glint across the face
          const spec = Math.pow(clamp(1 - Math.abs(f - 0.62) * 5), 2)
          if (spec > 0.02) {
            const mx1 = lerp(ax, dx, 0.3)
            const my1 = lerp(ay, dy, 0.3)
            const mx2 = lerp(bx, ccx, 0.3)
            const my2 = lerp(by, ccy, 0.3)
            ctx.strokeStyle = `rgba(255,255,255,${(ribbonA * spec * 0.55).toFixed(3)})`
            ctx.lineWidth = 2.2
            ctx.beginPath()
            ctx.moveTo(mx1, my1)
            ctx.lineTo(mx2, my2)
            ctx.stroke()
          }
        }

        // ---------- cyan core + violet streams (additive light) ----------
        ctx.globalCompositeOperation = 'lighter'
        const pt = (i: number, k: number): P2 => {
          const c = Math.floor((i * CHUNKS) / N)
          const x = lerp(c2[i * 2], e1[i * 2], k)
          const y = lerp(c2[i * 2 + 1], e1[i * 2 + 1], k)
          return chunkXf(c, x, y)
        }
        for (let i = 0; i < N; i++) {
          const j = (i + 1) % N
          if (Math.floor((i * CHUNKS) / N) !== Math.floor((j * CHUNKS) / N)) continue
          const q = ((i * CHUNKS) / N) % 1
          if (q < sep * 0.32 && sep > 0.02) continue
          const v = (i / N) * Math.PI * 2
          const pulse = Math.pow(0.5 + 0.5 * Math.sin(v * 4 - flowPhase * 1.6), 3)
          const ca = ribbonA * (0.35 + 0.65 * pulse * lerp(0.4, 1, seg(t, 0.4, 0.9)))
          const [x0, y0] = pt(i, 0)
          const [x1, y1] = pt(j, 0)
          ctx.strokeStyle = rgba(CYAN, ca * 0.22)
          ctx.lineWidth = 9
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
          ctx.stroke()
          ctx.strokeStyle = rgba([150, 240, 255], ca)
          ctx.lineWidth = 2.2
          ctx.stroke()
          for (let s = 0; s < 2; s++) {
            const k0 = 0.62 * Math.sin(v * 7 + t * 3.2 + s * Math.PI)
            const k1 = 0.62 * Math.sin(((j / N) * Math.PI * 2) * 7 + t * 3.2 + s * Math.PI)
            const [sx0, sy0] = pt(i, k0)
            const [sx1, sy1] = pt(j, k1)
            ctx.strokeStyle = rgba(s ? PURPLE : INDIGO, ribbonA * 0.45)
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.moveTo(sx0, sy0)
            ctx.lineTo(sx1, sy1)
            ctx.stroke()
          }
        }
        ctx.globalCompositeOperation = 'source-over'
      }

      // ---------- interface outlines "crystallising" (wave / threads) ----------
      if (variant !== 'vortex') {
        ctx.globalCompositeOperation = 'lighter'
        targets.forEach((r, i) => {
          const a = bump(reveal[i]) * 0.9
          if (a <= 0.01) return
          ctx.strokeStyle = rgba(i % 2 ? VIOLET : CYAN, a)
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.roundRect(r.x, r.y, r.w, r.h, r.r)
          ctx.stroke()
        })
        ctx.globalCompositeOperation = 'source-over'
      }
      if (variant === 'wave' && waveR > 0 && waveR < maxD * 1.15) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = rgba(CYAN, 0.55 * (1 - seg(t, 2.8, 3.25)))
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cx, cy, waveR, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalCompositeOperation = 'source-over'
      }

      // ---------- threads (variant 3) ----------
      const nT = targets.length
      const bez = (k: number, p0: P2, p1: P2, p2: P2, p3: P2): P2 => {
        const m = 1 - k
        return [
          m * m * m * p0[0] + 3 * m * m * k * p1[0] + 3 * m * k * k * p2[0] + k * k * k * p3[0],
          m * m * m * p0[1] + 3 * m * m * k * p1[1] + 3 * m * k * k * p2[1] + k * k * k * p3[1],
        ]
      }
      const threadCurve = (i: number): [P2, P2, P2, P2] => {
        const r = targets[i]
        const c = (i * 7) % CHUNKS
        const p0: P2 = [chC[c * 2], chC[c * 2 + 1]]
        const p3: P2 = [r.x + r.w / 2, r.y + r.h / 2]
        const dx = p3[0] - p0[0]
        const dy = p3[1] - p0[1]
        const sgn = i % 2 ? 1 : -1
        return [p0, [p0[0] - dy * 0.45 * sgn, p0[1] + dx * 0.45 * sgn], [p3[0] - dx * 0.25 + dy * 0.2 * sgn, p3[1] - dy * 0.25 - dx * 0.2 * sgn], p3]
      }
      const headOf = (i: number) => eio(seg(t, SPLASH_RELEASE + (i / Math.max(1, nT)) * 0.35, SPLASH_RELEASE + (i / Math.max(1, nT)) * 0.35 + 0.8))
      if (variant === 'threads' && nT && out > 0) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (let i = 0; i < nT; i++) {
          const h = headOf(i)
          if (h <= 0) continue
          const fade = 1 - seg(t, SPLASH_RELEASE + (i / nT) * 0.35 + 0.8, SPLASH_RELEASE + (i / nT) * 0.35 + 1.05)
          if (fade <= 0) continue
          const cv = threadCurve(i)
          const col = i % 2 ? PURPLE : CYAN
          let prev = bez(Math.max(0, h - 0.45), ...cv)
          for (let s = 1; s <= 22; s++) {
            const k = Math.max(0, h - 0.45) + ((h - Math.max(0, h - 0.45)) * s) / 22
            const p = bez(k, ...cv)
            const a = (s / 22) * fade
            ctx.strokeStyle = rgba(col, a * 0.25)
            ctx.lineWidth = 8
            ctx.beginPath()
            ctx.moveTo(prev[0], prev[1])
            ctx.lineTo(p[0], p[1])
            ctx.stroke()
            ctx.strokeStyle = rgba(mixc(col, [255, 255, 255], 0.5), a)
            ctx.lineWidth = 2
            ctx.stroke()
            prev = p
          }
          ctx.fillStyle = `rgba(255,255,255,${(0.9 * fade).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(prev[0], prev[1], 3.2, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }

      // ---------- particles ----------
      const pa = seg(t, 0.55, 1.5)
      if (pa > 0) {
        ctx.globalCompositeOperation = 'lighter'
        const tr = travel(t)
        for (let n = 0; n < PARTICLES; n++) {
          const p = parts[n]
          const uu = (((p.u + tr * p.spd) % 1) + 1) % 1
          const i = Math.floor(uu * N) % N
          const c = Math.floor((i * CHUNKS) / N)
          const spread = 1 + sep * 1.1
          const wx = e1[i * 2] - c2[i * 2]
          const wy = e1[i * 2 + 1] - c2[i * 2 + 1]
          const wl = Math.hypot(wx, wy) || 1
          let x = c2[i * 2] + wx * p.off * spread + (wx / wl) * p.push * sep * 16
          let y = c2[i * 2 + 1] + wy * p.off * spread + (wy / wl) * p.push * sep * 16
          ;[x, y] = chunkXf(c, x, y)
          let a = pa * (0.55 + 0.45 * Math.sin(t * 6 + n))
          let size = p.size * (1 + live * 0.4)
          if (nT && t > SPLASH_RELEASE) {
            const r = targets[n % nT]
            let tx: number
            let ty: number
            if (variant === 'wave') {
              // crystallise on the card's outline
              const per = 2 * (r.w + r.h)
              let d = p.tx * per
              if (d < r.w) [tx, ty] = [r.x + d, r.y]
              else if ((d -= r.w) < r.h) [tx, ty] = [r.x + r.w, r.y + d]
              else if ((d -= r.h) < r.w) [tx, ty] = [r.x + r.w - d, r.y + r.h]
              else [tx, ty] = [r.x, r.y + r.h - (d - r.w)]
            } else {
              tx = r.x + p.tx * r.w
              ty = r.y + p.ty * r.h
            }
            if (variant === 'threads') {
              const cv = threadCurve(n % nT)
              const k = headOf(n % nT) - p.delay * 0.35
              if (k > 0) {
                const q = bez(clamp(k), ...cv)
                const perp = p.push * 10 * (1 - k)
                x = q[0] + perp
                y = q[1] - perp
                a *= 1 - seg(k, 0.85, 1)
              } else a *= 1 - out * 0.5
            } else {
              const s0 = SPLASH_RELEASE + p.delay * 0.35
              const k = eio(seg(t, s0, s0 + (variant === 'wave' ? 0.75 : 0.9)))
              if (k > 0) {
                // spiral (vortex) or straight radial push (wave) from the ∞ to the interface
                const r0 = Math.hypot(x - cx, y - cy)
                const a0 = Math.atan2(y - cy, x - cx)
                const r1 = Math.hypot(tx - cx, ty - cy)
                let a1 = Math.atan2(ty - cy, tx - cx)
                if (variant === 'vortex') {
                  if (p.swirl > 0) while (a1 < a0) a1 += Math.PI * 2
                  else while (a1 > a0) a1 -= Math.PI * 2
                  a1 += p.swirl * Math.PI * 0.5
                } else {
                  while (a1 - a0 > Math.PI) a1 -= Math.PI * 2
                  while (a0 - a1 > Math.PI) a1 += Math.PI * 2
                }
                const rr = lerp(r0, r1, k)
                const aa = lerp(a0, a1, variant === 'vortex' ? eo(k) : k)
                x = cx + Math.cos(aa) * rr
                y = cy + Math.sin(aa) * rr
                size *= lerp(1.4, 0.8, k)
                a *= 1 - seg(k, 0.75, 1) * 0.85
              }
            }
            a *= 1 - seg(t, 3.15, 3.5)
          } else if (t > SPLASH_RELEASE) {
            a *= 1 - out
          }
          if (a <= 0.01) continue
          ctx.fillStyle = rgba(p.col, clamp(a))
          ctx.beginPath()
          ctx.arc(x, y, size, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.globalAlpha = 1
    },
  }
}

/** Rects of the interface the splash dissolves into (read-only DOM query; nothing in the UI is changed). */
export function collectUiRects(W: number, H: number): UiRect[] {
  const out: UiRect[] = []
  const add = (el: Element, r: number) => {
    const b = el.getBoundingClientRect()
    if (b.width * b.height < 400 || b.right < 0 || b.bottom < 0 || b.left > W || b.top > H) return
    out.push({ x: b.left, y: b.top, w: b.width, h: b.height, r })
  }
  document.querySelectorAll('.top-bar').forEach((e) => add(e, 0))
  document.querySelectorAll('.canvas-board__world .frame').forEach((e) => add(e, 16))
  document.querySelectorAll('[data-note-id]').forEach((e) => add(e, 14))
  document.querySelectorAll('.command-dock').forEach((e) => add(e, 22))
  document.querySelectorAll('.lang-pick__card, .lang-pick .glass-panel').forEach((e) => add(e, 20))
  out.splice(28)
  if (!out.length) out.push({ x: 0, y: 0, w: W, h: H, r: 0 })
  return out
}
