import { useCallback, useRef } from 'react'
import { usePersistentState } from './usePersistentState'

export interface CanvasTransform {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.1
const MAX_SCALE = 2

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

export function useCanvasTransform(storageKey = 'canvas-transform', initial: CanvasTransform = { x: 0, y: 0, scale: 1 }) {
  const [transform, setTransform] = usePersistentState<CanvasTransform>(storageKey, initial)

  const isPanning = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  const startPan = useCallback((clientX: number, clientY: number) => {
    isPanning.current = true
    last.current = { x: clientX, y: clientY }
  }, [])

  const panTo = useCallback(
    (clientX: number, clientY: number) => {
      if (!isPanning.current) return
      const dx = clientX - last.current.x
      const dy = clientY - last.current.y
      last.current = { x: clientX, y: clientY }
      setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
    },
    [setTransform],
  )

  const endPan = useCallback(() => {
    isPanning.current = false
  }, [])

  // Zoom events are accumulated and applied once per frame, so a burst of trackpad
  // events never re-renders the board dozens of times per frame (that caused the jitter).
  const pendingZoom = useRef<{ log: number; x: number; y: number } | null>(null)
  const zoomFrame = useRef<number | null>(null)
  const zoomAt = useCallback(
    (clientX: number, clientY: number, delta: number) => {
      const p = pendingZoom.current
      pendingZoom.current = { log: (p?.log ?? 0) + Math.max(-0.5, Math.min(0.5, delta)), x: clientX, y: clientY }
      if (zoomFrame.current !== null) return
      zoomFrame.current = requestAnimationFrame(() => {
        zoomFrame.current = null
        const z = pendingZoom.current
        pendingZoom.current = null
        if (!z) return
        setTransform((t) => {
          let nextScale = clampScale(t.scale * Math.exp(z.log))
          // snap to exactly 100% when passing close to it
          if (Math.abs(nextScale - 1) < 0.015) nextScale = 1
          if (nextScale === t.scale) return t
          const ratio = nextScale / t.scale
          return {
            scale: nextScale,
            x: z.x - (z.x - t.x) * ratio,
            y: z.y - (z.y - t.y) * ratio,
          }
        })
      })
    },
    [setTransform],
  )

  const panBy = useCallback(
    (dx: number, dy: number) => {
      setTransform((t) => ({ ...t, x: t.x - dx, y: t.y - dy }))
    },
    [setTransform],
  )

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [setTransform])

  const setScale = useCallback(
    (scale: number, originX: number, originY: number) => {
      setTransform((t) => {
        const nextScale = clampScale(scale)
        const ratio = nextScale / t.scale
        return {
          scale: nextScale,
          x: originX - (originX - t.x) * ratio,
          y: originY - (originY - t.y) * ratio,
        }
      })
    },
    [setTransform],
  )

  /** Fit a world-space rectangle into the viewport (used by "fit all" and search jump). */
  const fitRect = useCallback(
    (r: { x: number; y: number; width: number; height: number }, maxScale = 1, pad = 120) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const scale = clampScale(
        Math.min(maxScale, (vw - pad * 2) / Math.max(r.width, 1), (vh - pad * 2) / Math.max(r.height, 1)),
      )
      setTransform({
        scale,
        x: vw / 2 - (r.x + r.width / 2) * scale,
        y: vh / 2 - (r.y + r.height / 2) * scale,
      })
    },
    [setTransform],
  )

  return { transform, startPan, panTo, endPan, zoomAt, panBy, resetView, setScale, fitRect }
}
