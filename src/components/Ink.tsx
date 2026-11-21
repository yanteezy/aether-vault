import { memo, useEffect, useRef, useState } from 'react'
import { INK_COLORS, INK_WIDTH, MARKER_ALPHA, type InkColor, type InkStroke, type InkTool } from '../types/note'
import type { CanvasTransform } from '../hooks/useCanvasTransform'
import './Ink.css'

const HEX = Object.fromEntries(INK_COLORS.map((c) => [c.id, c.hex])) as Record<InkColor, string>
/** «Крейда» follows the theme (white on dark, graphite on light). */
export const inkStroke = (c: InkColor) => (c === 'chalk' ? 'var(--ink-chalk, #ffffff)' : HEX[c])

/** Smooth SVG path through the points (quadratic curves via midpoints). */
export function strokePath(p: number[]): string {
  const n = p.length / 2
  if (n === 0) return ''
  const f = (v: number) => Math.round(v * 10) / 10
  if (n === 1) return `M${f(p[0])} ${f(p[1])}l0.01 0`
  if (n === 2) return `M${f(p[0])} ${f(p[1])}L${f(p[2])} ${f(p[3])}`
  let d = `M${f(p[0])} ${f(p[1])}`
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2]
    const y = p[i * 2 + 1]
    const mx = (x + p[i * 2 + 2]) / 2
    const my = (y + p[i * 2 + 3]) / 2
    d += `Q${f(x)} ${f(y)} ${f(mx)} ${f(my)}`
  }
  return d + `L${f(p[p.length - 2])} ${f(p[p.length - 1])}`
}

export function strokeBounds(s: InkStroke) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < s.points.length; i += 2) {
    const x = s.points[i] + s.x
    const y = s.points[i + 1] + s.y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

let pieceSeq = 0
const pieceId = () => `ink-${Date.now().toString(36)}-${(++pieceSeq).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/**
 * Paint-style eraser: rubs out only the part of a stroke under the eraser path
 * (segment a→b, radius r, world units). Returns null when the stroke is untouched,
 * otherwise the remaining pieces (possibly none).
 */
export function eraseFromStroke(s: InkStroke, ax: number, ay: number, bx: number, by: number, r: number): InkStroke[] | null {
  const reach = r + INK_WIDTH[s.tool] / 2
  const b = strokeBounds(s)
  if (
    Math.max(ax, bx) < b.minX - reach ||
    Math.min(ax, bx) > b.maxX + reach ||
    Math.max(ay, by) < b.minY - reach ||
    Math.min(ay, by) > b.maxY + reach
  )
    return null
  // densify so a cut can land in the middle of a long straight segment
  const step = Math.max(0.5, reach / 3)
  const p = s.points
  const dense: number[] = [p[0], p[1]]
  for (let i = 2; i + 1 < p.length; i += 2) {
    const x0 = p[i - 2]
    const y0 = p[i - 1]
    const len = Math.hypot(p[i] - x0, p[i + 1] - y0)
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 1; k <= n; k++) dense.push(x0 + ((p[i] - x0) * k) / n, y0 + ((p[i + 1] - y0) * k) / n)
  }
  const ex0 = ax - s.x
  const ey0 = ay - s.y
  const ex1 = bx - s.x
  const ey1 = by - s.y
  const pieces: number[][] = []
  let cur: number[] = []
  let removed = false
  for (let i = 0; i < dense.length; i += 2) {
    if (distToSeg(dense[i], dense[i + 1], ex0, ey0, ex1, ey1) <= reach) {
      removed = true
      if (cur.length) pieces.push(cur)
      cur = []
    } else cur.push(dense[i], dense[i + 1])
  }
  if (!removed) return null
  if (cur.length) pieces.push(cur)
  return pieces
    .filter((pc) => pc.length >= 4) // drop lone specks left at the cut
    .map((pc) => ({ ...s, id: pieceId(), points: simplify(pc, step / 2) }))
}

/** Drop the extra densified points on straight runs (keeps files small). */
function simplify(p: number[], tol: number): number[] {
  if (p.length <= 4) return p.map((v) => Math.round(v * 10) / 10)
  const out = [p[0], p[1]]
  for (let i = 2; i + 3 < p.length; i += 2) {
    const ox = out[out.length - 2]
    const oy = out[out.length - 1]
    if (distToSeg(p[i], p[i + 1], ox, oy, p[i + 2], p[i + 3]) > tol * 0.2) out.push(p[i], p[i + 1])
  }
  out.push(p[p.length - 2], p[p.length - 1])
  return out.map((v) => Math.round(v * 10) / 10)
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const StrokeView = memo(function StrokeView({ s, selected }: { s: InkStroke; selected?: boolean }) {
  const d = strokePath(s.points)
  return (
    <path
      d={d}
      transform={s.x || s.y ? `translate(${s.x} ${s.y})` : undefined}
      style={{
        stroke: inkStroke(s.color),
        strokeWidth: INK_WIDTH[s.tool],
        strokeOpacity: s.tool === 'marker' ? MARKER_ALPHA : 1,
      }}
      className={`ink-stroke ink-stroke--${s.tool}${selected ? ' is-selected' : ''}`}
    />
  )
})

/**
 * Saved strokes, rendered inside the world (pans & zooms with the canvas).
 * With `onStrokeDown` (not drawing) every stroke gets a wide invisible grip to select / move it.
 */
export function InkLayer({
  strokes,
  selected,
  onStrokeDown,
}: {
  strokes: InkStroke[]
  selected?: string[]
  onStrokeDown?: (id: string, e: React.PointerEvent) => void
}) {
  if (!strokes.length) return null
  return (
    <svg className="ink-layer" aria-hidden>
      {strokes.map((s) => (
        <StrokeView key={s.id} s={s} selected={selected?.includes(s.id)} />
      ))}
      {onStrokeDown &&
        strokes.map((s) => (
          <path
            key={'hit-' + s.id}
            d={strokePath(s.points)}
            transform={s.x || s.y ? `translate(${s.x} ${s.y})` : undefined}
            className="ink-hit"
            data-stroke-id={s.id}
            style={{ strokeWidth: INK_WIDTH[s.tool] + 14 }}
            onPointerDown={(e) => onStrokeDown(s.id, e)}
          />
        ))}
    </svg>
  )
}

interface InkCaptureProps {
  transform: CanvasTransform
  tool: InkTool
  color: InkColor
  strokes: InkStroke[]
  onAddStroke: (s: InkStroke) => void
  /** Called once when an eraser gesture starts (for undo). */
  onEraseStart: () => void
  /** Stroke id → what is left of it (empty = fully erased). */
  onErase: (changes: Map<string, InkStroke[]>) => void
  onEraseEnd: () => void
  /** Space / middle button = pan the board while drawing. */
  onPanStart: (e: React.PointerEvent) => void
  onPanMove: (e: React.PointerEvent) => void
  onPanEnd: (e: React.PointerEvent) => void
}

const ERASER_PX = 12

/** Transparent overlay that turns pointer input into strokes while Draw mode is on. */
export function InkCapture({
  transform,
  tool,
  color,
  strokes,
  onAddStroke,
  onEraseStart,
  onErase,
  onEraseEnd,
  onPanStart,
  onPanMove,
  onPanEnd,
}: InkCaptureProps) {
  const [live, setLive] = useState<number[] | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [space, setSpace] = useState(false)
  const pts = useRef<number[] | null>(null)
  const mode = useRef<'draw' | 'erase' | 'pan' | null>(null)
  const raf = useRef(0)
  const t = useRef(transform)
  t.current = transform
  const all = useRef(strokes)
  all.current = strokes

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !(e.target as HTMLElement)?.closest?.('input, textarea')) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpace(false)
    }
    const blur = () => setSpace(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      cancelAnimationFrame(raf.current)
    }
  }, [])

  const toWorld = (cx: number, cy: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const tr = t.current
    return [(cx - r.left - tr.x) / tr.scale, (cy - r.top - tr.y) / tr.scale]
  }

  const lastErase = useRef<number[] | null>(null)
  const erase = (e: React.PointerEvent<HTMLElement>) => {
    const [x, y] = toWorld(e.clientX, e.clientY, e.currentTarget)
    // sweep from the previous point, so a fast drag leaves no gaps
    const [px, py] = lastErase.current ?? [x, y]
    lastErase.current = [x, y]
    const r = ERASER_PX / t.current.scale
    const changes = new Map<string, InkStroke[]>()
    for (const s of all.current) {
      const left = eraseFromStroke(s, px, py, x, y, r)
      if (left) changes.set(s.id, left)
    }
    if (changes.size) {
      // keep the local copy in sync until React re-renders (several moves per frame)
      all.current = all.current.flatMap((s) => changes.get(s.id) ?? [s])
      onErase(changes)
    }
  }

  const flush = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => setLive(pts.current ? [...pts.current] : null))
  }

  return (
    <div
      className={`ink-capture ink-capture--${space ? 'pan' : tool}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* pointer already gone */
        }
        if (space || e.button === 1) {
          mode.current = 'pan'
          onPanStart(e)
          return
        }
        if (e.button !== 0) return
        if (tool === 'eraser') {
          mode.current = 'erase'
          lastErase.current = null
          onEraseStart()
          erase(e)
          return
        }
        mode.current = 'draw'
        pts.current = toWorld(e.clientX, e.clientY, e.currentTarget)
        flush()
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
        if (mode.current === 'pan') return onPanMove(e)
        if (mode.current === 'erase') return erase(e)
        if (mode.current !== 'draw' || !pts.current) return
        const minStep = 1.2 / t.current.scale
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const [x, y] = toWorld(ev.clientX, ev.clientY, e.currentTarget)
          const p = pts.current
          if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= minStep) p.push(x, y)
        }
        flush()
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        const m = mode.current
        mode.current = null
        if (m === 'pan') return onPanEnd(e)
        if (m === 'erase') return onEraseEnd()
        if (m !== 'draw' || !pts.current) return
        const p = pts.current
        pts.current = null
        cancelAnimationFrame(raf.current)
        setLive(null)
        onAddStroke({
          id: `ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          tool: tool === 'marker' ? 'marker' : 'pen',
          color,
          points: p.map((v) => Math.round(v * 10) / 10),
          x: 0,
          y: 0,
        })
      }}
      onPointerCancel={(e) => {
        if (mode.current === 'pan') onPanEnd(e)
        if (mode.current === 'erase') onEraseEnd()
        mode.current = null
        pts.current = null
        setLive(null)
      }}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {live && tool !== 'eraser' && (
        <svg className="ink-capture__live" aria-hidden>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
            <path
              d={strokePath(live)}
              className={`ink-stroke ink-stroke--${tool}`}
              style={{
                stroke: inkStroke(color),
                strokeWidth: INK_WIDTH[tool === 'marker' ? 'marker' : 'pen'],
                strokeOpacity: tool === 'marker' ? MARKER_ALPHA : 1,
              }}
            />
          </g>
        </svg>
      )}
      {cursor && !space && tool !== 'eraser' && (
        <span
          className="ink-capture__dot"
          style={{
            transform: `translate(${cursor.x}px, ${cursor.y}px)`,
            width: Math.max(4, INK_WIDTH[tool === 'marker' ? 'marker' : 'pen'] * transform.scale),
            height: Math.max(4, INK_WIDTH[tool === 'marker' ? 'marker' : 'pen'] * transform.scale),
            background: inkStroke(color),
            opacity: tool === 'marker' ? 0.5 : 0.9,
          }}
        />
      )}
      {cursor && !space && tool === 'eraser' && (
        <span
          className="ink-capture__eraser"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, width: ERASER_PX * 2, height: ERASER_PX * 2 }}
        />
      )}
    </div>
  )
}
