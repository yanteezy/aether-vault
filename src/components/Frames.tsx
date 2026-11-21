import { memo, useEffect, useRef, useState } from 'react'
import { FRAME_COLORS, type Frame, type FrameColor } from '../types/note'
import { useT } from '../i18n'
import type { ObjectFx } from '../effects/tagEffects'
import './Frames.css'

export const FRAME_MIN_W = 200
export const FRAME_MIN_H = 140

const RGB = Object.fromEntries(FRAME_COLORS.map((c) => [c.id, c.rgb])) as Record<FrameColor, string>

type Corner = 'nw' | 'ne' | 'sw' | 'se'

export interface FrameHandlers {
  onSelect: (id: string | null) => void
  onPatch: (id: string, patch: Partial<Frame>) => void
  onDelete: (id: string) => void
  onFit: (id: string) => void
  /** Group drag: start snapshots the contents, move gives the total world offset. */
  onDragStart: (id: string) => void
  onDrag: (id: string, dx: number, dy: number) => void
  onDragEnd: (id: string) => void
  /** Right click: open the frame menu at client coordinates. */
  onContextMenu: (id: string, x: number, y: number) => void
}

interface LayerProps extends FrameHandlers {
  frames: Frame[]
  counts: Map<string, number>
  scale: number
  selectedId: string | null
  /** Frames taken by a multi-selection. */
  selectedIds?: string[]
  /** Effects of switched-on tag buttons, per frame id. */
  fx?: Map<string, ObjectFx[]>
}

/** Smart Frames: glass groups drawn under the notes (inside the world). */
export function FrameLayer({ frames, counts, scale, selectedId, selectedIds, fx, ...h }: LayerProps) {
  const s = useRef(scale)
  s.current = scale
  const hRef = useRef(h)
  hRef.current = h
  return (
    <>
      {frames.map((f) => (
        <FrameView
          key={f.id}
          frame={f}
          count={counts.get(f.id) ?? 0}
          selected={selectedId === f.id || !!selectedIds?.includes(f.id)}
          fx={fx?.get(f.id)}
          scaleRef={s}
          hRef={hRef}
        />
      ))}
    </>
  )
}

const FrameView = memo(function FrameView({
  frame: f,
  count,
  selected,
  fx,
  scaleRef,
  hRef,
}: {
  frame: Frame
  count: number
  selected: boolean
  fx?: ObjectFx[]
  scaleRef: React.MutableRefObject<number>
  hRef: React.MutableRefObject<FrameHandlers>
}) {
  const tr = useT()
  const [editing, setEditing] = useState(false)
  const [palette, setPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState(f.title)
  useEffect(() => setDraft(f.title), [f.title])
  useEffect(() => {
    if (!selected) setPalette(false)
  }, [selected])

  /** Shared pointer tracking: calls `move` with the world delta from the press point. */
  const track = (e: React.PointerEvent, move: (dx: number, dy: number) => void, end?: () => void) => {
    e.stopPropagation()
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const onMove = (ev: PointerEvent) => {
      const k = scaleRef.current
      move((ev.clientX - sx) / k, (ev.clientY - sy) / k)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      end?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    hRef.current.onSelect(f.id)
    hRef.current.onContextMenu(f.id, e.clientX, e.clientY)
  }

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const h = hRef.current
    h.onSelect(f.id)
    if (f.locked) return e.stopPropagation()
    h.onDragStart(f.id)
    setDragging(true)
    track(
      e,
      (dx, dy) => hRef.current.onDrag(f.id, dx, dy),
      () => {
        setDragging(false)
        hRef.current.onDragEnd(f.id)
      },
    )
  }

  const startResize = (corner: Corner) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    hRef.current.onSelect(f.id)
    if (f.locked) return e.stopPropagation()
    const r0 = { x: f.x, y: f.y, w: f.width, h: f.height }
    setDragging(true)
    track(
      e,
      (dx, dy) => {
        let { x, y, w, h } = r0
        if (corner.includes('e')) w = Math.max(FRAME_MIN_W, r0.w + dx)
        if (corner.includes('s')) h = Math.max(FRAME_MIN_H, r0.h + dy)
        if (corner.includes('w')) {
          w = Math.max(FRAME_MIN_W, r0.w - dx)
          x = r0.x + r0.w - w
        }
        if (corner.includes('n')) {
          h = Math.max(FRAME_MIN_H, r0.h - dy)
          y = r0.y + r0.h - h
        }
        hRef.current.onPatch(f.id, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) })
      },
      () => setDragging(false),
    )
  }

  const commitTitle = () => {
    setEditing(false)
    const t = draft.trim()
    if (t !== f.title) hRef.current.onPatch(f.id, { title: t })
    else setDraft(f.title)
  }

  return (
    <div
      className={`frame frame--${f.color}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${f.locked ? ' is-locked' : ''}`}
      data-frame-id={f.id}
      data-fx={fx?.length ? fx.map((x) => x.effect).join(' ') : undefined}
      style={
        {
          transform: `translate(${f.x}px, ${f.y}px)`,
          width: f.width,
          height: f.height,
          '--frame-rgb': RGB[f.color] ?? RGB.default,
          '--fx-color': fx?.length ? fx[fx.length - 1].color : undefined,
        } as React.CSSProperties
      }
    >
      {/* thin edge strips: grab the border to move the group */}
      {(['t', 'r', 'b', 'l'] as const).map((side) => (
        <div key={side} className={`frame__edge frame__edge--${side}`} onPointerDown={startDrag} onContextMenu={openMenu} />
      ))}

      <div
        className="frame__header"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, input')) return e.stopPropagation()
          startDrag(e)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if ((e.target as HTMLElement).closest('button')) return
          setEditing(true)
        }}
        onContextMenu={openMenu}
      >
        <button
          className="frame__dot"
          aria-label={tr('Колір рамки')}
          title={tr('Колір рамки')}
          onClick={() => {
            hRef.current.onSelect(f.id)
            setPalette((p) => !p)
          }}
        />
        {editing ? (
          <input
            className="frame__title-input"
            autoFocus
            value={draft}
            maxLength={80}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setDraft(f.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span className="frame__title" title={tr('Двічі клацніть, щоб перейменувати')}>
            {f.title || tr('Група')}
          </span>
        )}
        <span className="frame__count" title={tr('Нотаток у рамці')}>
          {count}
        </span>
        {f.locked && (
          <span className="frame__lock" title={tr('Позицію закріплено')}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
              <rect x="2" y="5.2" width="8" height="5.6" rx="1.3" fill="currentColor" />
              <path d="M3.8 5.4V3.9a2.2 2.2 0 0 1 4.4 0v1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            </svg>
          </span>
        )}
        <div className="frame__tools">
          <button
            className="frame__tool"
            title={tr('Підігнати під вміст')}
            aria-label={tr('Підігнати під вміст')}
            disabled={!count || f.locked}
            onClick={() => hRef.current.onFit(f.id)}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden>
              <path
                d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="frame__tool is-danger"
            title={tr('Видалити рамку (нотатки залишаться)')}
            aria-label={tr('Видалити рамку')}
            onClick={() => hRef.current.onDelete(f.id)}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden>
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {palette && (
        <div className="frame__palette glass-panel-strong" onPointerDown={(e) => e.stopPropagation()}>
          {FRAME_COLORS.map((c) => (
            <button
              key={c.id}
              title={tr(c.label)}
              aria-label={tr(c.label)}
              className={`frame__swatch${f.color === c.id ? ' is-active' : ''}`}
              style={{ '--sw': c.rgb } as React.CSSProperties}
              onClick={() => {
                hRef.current.onPatch(f.id, { color: c.id })
                setPalette(false)
              }}
            />
          ))}
        </div>
      )}

      {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
        <div key={c} className={`frame__handle frame__handle--${c}`} onPointerDown={startResize(c)} onContextMenu={openMenu} />
      ))}
    </div>
  )
})
