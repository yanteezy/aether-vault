import { useEffect, useRef } from 'react'
import type { InkStroke } from '../types/note'
import { useImageUrl, type NoteImage } from '../features/images'
import { InkLayer } from './Ink'
import { useT } from '../i18n'
import './NoteBackdrop.css'

/**
 * Everything drawn UNDER the note's text: its photo and the drawings attached to it.
 * In «adjust photo» mode the photo can be dragged (pan) and scrolled (zoom).
 */
export function NoteBackdrop({
  image,
  ink,
  editing,
  onPatch,
  onDone,
}: {
  image?: NoteImage
  ink?: InkStroke[]
  editing?: boolean
  onPatch?: (patch: Partial<NoteImage>) => void
  onDone?: () => void
}) {
  const tr = useT()
  const url = useImageUrl(image?.id)
  const box = useRef<HTMLDivElement>(null)
  const zoom = image?.zoom ?? 1
  const x = image?.x ?? 0
  const y = image?.y ?? 0

  // Enter / Escape / a click outside the note finish adjusting
  useEffect(() => {
    if (!editing) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onDone?.()
      }
    }
    const down = (e: PointerEvent) => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onDone?.()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
    }
  }, [editing, onDone])

  const clampPan = (v: number) => Math.max(-50 * zoom, Math.min(50 * zoom, v))

  return (
    <>
      {image && (
        <div
          ref={box}
          className={`note-photo${editing ? ' is-editing' : ''}`}
          style={{ '--dim': image.dim ?? 0 } as React.CSSProperties}
          data-no-drag={editing ? '' : undefined}
          onPointerDown={
            editing
              ? (e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  const r = box.current!.getBoundingClientRect()
                  const sx = e.clientX
                  const sy = e.clientY
                  const x0 = x
                  const y0 = y
                  const move = (ev: PointerEvent) =>
                    onPatch?.({
                      x: Math.round(clampPan(x0 + ((ev.clientX - sx) / r.width) * 100) * 10) / 10,
                      y: Math.round(clampPan(y0 + ((ev.clientY - sy) / r.height) * 100) * 10) / 10,
                    })
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }
              : undefined
          }
          onWheel={
            editing
              ? (e) => {
                  e.stopPropagation()
                  const z = Math.max(1, Math.min(4, Math.round((zoom * Math.exp(-e.deltaY * 0.002)) * 100) / 100))
                  onPatch?.({ zoom: z })
                }
              : undefined
          }
        >
          {url && (
            <img
              src={url}
              alt=""
              draggable={false}
              style={{
                objectFit: image.fit ?? 'cover',
                transform: `translate(${x}%, ${y}%) scale(${zoom})`,
              }}
            />
          )}
          <span className="note-photo__dim" />
          {editing && (
            <div className="note-photo__hint">
              <span>{tr('Тягніть — посунути · колесо — масштаб')}</span>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onDone?.()
                }}
              >
                {tr('Готово')}
              </button>
            </div>
          )}
        </div>
      )}
      {ink && ink.length > 0 && (
        <div className="note-ink">
          <InkLayer strokes={ink} />
        </div>
      )}
    </>
  )
}
