import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CanvasTransform } from '../hooks/useCanvasTransform'

/**
 * Natural cork-board texture drawn on a <canvas>.
 * A seamless random tile is generated once; it is painted with the exact same
 * transform as the notes, so the board moves and zooms together with them.
 * Two zoom levels are cross-faded so zooming in/out never "pops".
 */

const TILE = 1024 // texels
const TEXEL = 0.5 // world px per texel at level scale 1 → tile = 512 world px

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let tileCache: HTMLCanvasElement | null = null

function corkTile(): HTMLCanvasElement {
  if (tileCache) return tileCache
  const c = document.createElement('canvas')
  c.width = c.height = TILE
  const g = c.getContext('2d')!
  const rnd = mulberry32(20261120)

  // draws fn at (x,y) and at every wrapped copy that touches the tile → seamless
  const wrap = (x: number, y: number, r: number, fn: (x: number, y: number) => void) => {
    for (const ox of [-TILE, 0, TILE])
      for (const oy of [-TILE, 0, TILE]) {
        const px = x + ox
        const py = y + oy
        if (px + r < 0 || py + r < 0 || px - r > TILE || py - r > TILE) continue
        fn(px, py)
      }
  }

  g.fillStyle = '#9a6a40'
  g.fillRect(0, 0, TILE, TILE)

  // low-frequency mottling (lighter / darker patches)
  for (let i = 0; i < 90; i++) {
    const x = rnd() * TILE
    const y = rnd() * TILE
    const r = 60 + rnd() * 220
    const light = rnd() < 0.5
    const a = 0.06 + rnd() * 0.1
    wrap(x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r)
      grd.addColorStop(0, light ? `rgba(200,150,98,${a})` : `rgba(60,34,14,${a})`)
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grd
      g.fillRect(px - r, py - r, r * 2, r * 2)
    })
  }

  // cork granules of different size, shape and tint
  const palette = [
    [72, 42, 18],
    [92, 56, 26],
    [128, 84, 44],
    [176, 128, 80],
    [196, 150, 100],
    [150, 102, 58],
  ]
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * TILE
    const y = rnd() * TILE
    const big = rnd() < 0.08
    const rx = big ? 2.5 + rnd() * 4 : 0.7 + rnd() * 2.2
    const ry = rx * (0.45 + rnd() * 0.55)
    const rot = rnd() * Math.PI
    const [r, gg, b] = palette[(rnd() * palette.length) | 0]
    const a = big ? 0.18 + rnd() * 0.22 : 0.22 + rnd() * 0.4
    g.fillStyle = `rgba(${r},${gg},${b},${a})`
    wrap(x, y, rx, (px, py) => {
      g.beginPath()
      g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2)
      g.fill()
    })
  }

  // dark pores
  for (let i = 0; i < 900; i++) {
    const x = rnd() * TILE
    const y = rnd() * TILE
    const rr = 0.8 + rnd() * 2
    g.fillStyle = `rgba(38,20,8,${0.3 + rnd() * 0.3})`
    wrap(x, y, rr, (px, py) => {
      g.beginPath()
      g.ellipse(px, py, rr, rr * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2)
      g.fill()
    })
  }

  // fine per-pixel grain
  const img = g.getImageData(0, 0, TILE, TILE)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 22
    d[i] += n
    d[i + 1] += n * 0.85
    d[i + 2] += n * 0.7
  }
  g.putImageData(img, 0, 0)

  tileCache = c
  return c
}

export function CorkBackground({ transform }: { transform: CanvasTransform }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const patternRef = useRef<CanvasPattern | null>(null)
  const tRef = useRef(transform)
  tRef.current = transform

  const draw = () => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth
    const h = cv.clientHeight
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    }
    if (!patternRef.current) patternRef.current = ctx.createPattern(corkTile(), 'repeat')
    const pat = patternRef.current
    if (!pat) return
    const { x, y, scale } = tRef.current
    // level-of-detail: granules keep a natural on-screen size at any zoom
    const L = Math.log2(scale)
    const base = Math.floor(L)
    const f = L - base
    const lvl = scale / 2 ** base // ∈ [1, 2)
    const fade = f * f * (3 - 2 * f)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingQuality = 'high'
    const paint = (s: number, alpha: number) => {
      const k = s * TEXEL * dpr
      pat.setTransform(new DOMMatrix([k, 0, 0, k, x * dpr, y * dpr]))
      ctx.globalAlpha = alpha
      ctx.fillStyle = pat
      ctx.fillRect(0, 0, cv.width, cv.height)
    }
    paint(lvl, 1)
    if (fade > 0.001) paint(lvl / 2, fade)
    // zoomed out: soften the granules (−10% contrast) so the board doesn't shimmer under text
    if (scale < 0.8) {
      ctx.globalAlpha = Math.min(0.1, ((0.8 - scale) / 0.3) * 0.1)
      ctx.fillStyle = '#9a6a40'
      ctx.fillRect(0, 0, cv.width, cv.height)
    }
    ctx.globalAlpha = 1
  }

  useLayoutEffect(draw)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(cv)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={ref} className="cork-bg" aria-hidden />
}
