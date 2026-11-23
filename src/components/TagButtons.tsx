import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CHIP_COLORS, clampChipScale, chipScale, type ChipColor, type ChipSize, type TagChip } from '../types/note'
import { chipEffect, effectInfo, TAG_PRESETS } from '../effects/tagEffects'
import { useT } from '../i18n'
import './TagButtons.css'

/** Ready-made tag buttons in the Tags panel — defined with their effects in effects/tagEffects. */
/** Spoken / tooltip names of the button colours. */
const COLOR_NAMES: Partial<Record<ChipColor, string>> = {
  accent: 'Акцентний',
  red: 'Червоний',
  amber: 'Бурштиновий',
  green: 'Зелений',
  blue: 'Синій',
  purple: 'Фіолетовий',
  gray: 'Сірий',
}

export { TAG_PRESETS }

const CUSTOM_COLORS: ChipColor[] = ['accent', 'red', 'amber', 'green', 'blue', 'purple', 'gray']
const DRAG_PX = 4

/** Normalise user input into a tag: no #, no spaces at the ends, inner spaces → «-». */
export const cleanTag = (s: string) => s.replace(/^#+/, '').trim().replace(/\s+/g, '-').slice(0, 32)

export const snapTo = (v: number, step: number) => Math.round(v / step) * step

/** What the user dropped and where (client px); grab = pointer offset inside the chip. */
export interface ChipDrop {
  tag: string
  color: ChipColor
  clientX: number
  clientY: number
  grabX: number
  grabY: number
  snap: boolean
}

/** Face of a tag button: LED, label, count and — on canvas buttons — a real on/off switch. */
function ChipFace({ tag, count, toggle, on }: { tag: string; count?: number; toggle?: boolean; on?: boolean }) {
  return (
    <>
      <span className="tag-chip__led" aria-hidden />
      <span className="tag-chip__label">{tag}</span>
      {count !== undefined && count > 0 && <span className="tag-chip__count">{count}</span>}
      {toggle && (
        <span className={`tag-chip__switch${on ? ' is-on' : ''}`} aria-hidden>
          <i />
        </span>
      )}
    </>
  )
}

/** Pointer-driven drag out of the panel (HTML5 drag & drop is intercepted by Tauri on Windows). */
function useChipDrag(onDrop: (d: ChipDrop) => void) {
  const [ghost, setGhost] = useState<{ tag: string; color: ChipColor; x: number; y: number; snap: boolean } | null>(null)
  const start = (e: React.PointerEvent<HTMLElement>, tag: string, color: ChipColor, onClick: () => void) => {
    if (e.button !== 0 || !tag) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const grabX = Math.min(e.clientX - r.left, 40)
    const grabY = e.clientY - r.top
    const sx = e.clientX
    const sy = e.clientY
    let dragging = false
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return
      if (!dragging) document.body.classList.add('is-chip-dragging')
      dragging = true
      setGhost({ tag, color, x: ev.clientX - grabX, y: ev.clientY - grabY, snap: ev.ctrlKey || ev.metaKey })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('is-chip-dragging')
      setGhost(null)
      if (!dragging) return onClick()
      onDrop({ tag, color, clientX: ev.clientX, clientY: ev.clientY, grabX, grabY, snap: ev.ctrlKey || ev.metaKey })
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('is-chip-dragging')
      setGhost(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }
  const ghostEl = ghost
    ? createPortal(
        <div
          className={`tag-chip tag-chip--ghost${ghost.snap ? ' is-snapping' : ''}`}
          style={{ left: ghost.x, top: ghost.y, '--chip': CHIP_COLORS[ghost.color] } as React.CSSProperties}
        >
          <ChipFace tag={ghost.tag} />
        </div>,
        document.body,
      )
    : null
  return { start, ghostEl }
}

interface TagPanelProps {
  noteTags: { tag: string; count: number }[]
  activeFilters: string[]
  onToggleFilter: (tag: string) => void
  /** Click on a ready button: put it in the middle of the view. */
  onPlace: (tag: string, color: ChipColor) => void
  onDrop: (d: ChipDrop) => void
}

/** Body of the «Tags» side panel: ready buttons, a custom one, and the tags used in notes. */
export function TagPanel({ noteTags, activeFilters, onToggleFilter, onPlace, onDrop }: TagPanelProps) {
  const tr = useT()
  const { start, ghostEl } = useChipDrag(onDrop)
  const [custom, setCustom] = useState('')
  const [customColor, setCustomColor] = useState<ChipColor>('accent')
  const customTag = cleanTag(custom)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="tag-panel">
      <div className="tag-panel__section">{tr('Кнопки')}</div>
      <div className="tag-panel__hint">{tr('Перетягніть на полотно або на нотатку')}</div>
      <div className="tag-panel__chips">
        {TAG_PRESETS.map((p) => {
          const tag = tr(p.tag)
          return (
            <button
              key={p.tag}
              className="tag-chip tag-chip--source"
              style={{ '--chip': CHIP_COLORS[p.color] } as React.CSSProperties}
              title={tr('Клік — додати на полотно, перетягування — поставити куди треба')}
              onPointerDown={(e) => start(e, tag, p.color, () => onPlace(tag, p.color))}
            >
              <ChipFace tag={tag} />
            </button>
          )
        })}
      </div>

      <div className="tag-panel__custom">
        <input
          ref={inputRef}
          className="tag-panel__input"
          placeholder={tr('Свій тег…')}
          value={custom}
          maxLength={33}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customTag) {
              onPlace(customTag, customColor)
              setCustom('')
            }
            e.stopPropagation()
          }}
        />
        <div className="tag-panel__colors" role="radiogroup" aria-label={tr('Колір')}>
          {CUSTOM_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={customColor === c}
              className={`tag-panel__color${customColor === c ? ' is-active' : ''}`}
              style={{ backgroundColor: CHIP_COLORS[c] }}
              aria-label={tr(COLOR_NAMES[c] ?? c)}
              title={tr(COLOR_NAMES[c] ?? c)}
              onClick={() => setCustomColor(c)}
            />
          ))}
        </div>
        {customTag && (
          <button
            className="tag-chip tag-chip--source tag-chip--preview"
            style={{ '--chip': CHIP_COLORS[customColor] } as React.CSSProperties}
            title={tr('Клік — додати на полотно, перетягування — поставити куди треба')}
            onPointerDown={(e) =>
              start(e, customTag, customColor, () => {
                onPlace(customTag, customColor)
                setCustom('')
              })
            }
          >
            <ChipFace tag={customTag} />
          </button>
        )}
      </div>

      <div className="tag-panel__section">{tr('Теги нотаток')}</div>
      {noteTags.length === 0 && <div className="side-panel__empty">{tr('Немає тегів')}</div>}
      {noteTags.map(({ tag, count }) => (
        <button
          key={tag}
          className={`side-panel__item tag-panel__item${activeFilters.includes(tag) ? ' is-active' : ''}`}
          title={tr('Клік — фільтр, перетягування — кнопка на полотні')}
          onPointerDown={(e) => start(e, tag, 'accent', () => onToggleFilter(tag))}
        >
          <span>#{tag}</span>
          <span className="side-panel__count">{count}</span>
        </button>
      ))}
      {ghostEl}
    </div>
  )
}

// ---------- chips on the canvas ----------

type Rect = { x: number; y: number; width: number; height: number }
type WSide = 'l' | 'r' | 't' | 'b'

const CHIP_H: Record<ChipSize, number> = { s: 26, m: 32, l: 40 }
const NORMAL: Record<WSide, [number, number]> = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] }

/** Side of `a` that faces `b` (the axis with the bigger gap wins). */
function facing(a: Rect, b: Rect): WSide {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2)
  const dy = b.y + b.height / 2 - (a.y + a.height / 2)
  const gapX = Math.abs(dx) - (a.width + b.width) / 2
  const gapY = Math.abs(dy) - (a.height + b.height) / 2
  if (gapX >= gapY) return dx > 0 ? 'r' : 'l'
  return dy > 0 ? 'b' : 't'
}
const sidePoint = (r: Rect, s: WSide): [number, number] =>
  s === 'l' ? [r.x, r.y + r.height / 2] : s === 'r' ? [r.x + r.width, r.y + r.height / 2] : s === 't' ? [r.x + r.width / 2, r.y] : [r.x + r.width / 2, r.y + r.height]

/** Cable from a chip to a target: a soft cubic that leaves and enters along the side normals. */
function cable(from: Rect, to: Rect) {
  const s0 = facing(from, to)
  const s1 = facing(to, from)
  const p0 = sidePoint(from, s0)
  const p1 = sidePoint(to, s1)
  const k = Math.min(160, Math.max(30, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.45))
  const c0 = [p0[0] + NORMAL[s0][0] * k, p0[1] + NORMAL[s0][1] * k]
  const c1 = [p1[0] + NORMAL[s1][0] * k, p1[1] + NORMAL[s1][1] * k]
  const mid = [(p0[0] + 3 * c0[0] + 3 * c1[0] + p1[0]) / 8, (p0[1] + 3 * c0[1] + 3 * c1[1] + p1[1]) / 8]
  return { d: `M${p0[0]},${p0[1]} C${c0[0]},${c0[1]} ${c1[0]},${c1[1]} ${p1[0]},${p1[1]}`, start: p0, end: p1, mid }
}

interface ChipLayerProps {
  chips: TagChip[]
  scale: number
  gridStep: number
  counts: Map<string, number>
  activeFilters: string[]
  selectedId: string | null
  /** Buttons taken by a multi-selection. */
  selectedIds?: string[]
  /** Part of a multi-selection: moves with the group, never drops onto a note. */
  grouped?: (id: string) => boolean
  /** World rects of every note and frame a cable can plug into. */
  targets: Map<string, Rect>
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onClick: (chip: TagChip) => void
  onDelete: (id: string) => void
  /** Chip dropped while dragging over a note: tag that note. */
  onDropOnNote: (chip: TagChip, noteId: string) => void
  /** Cable released at a client point: wire the chip to whatever is there. */
  onWire: (chipId: string, clientX: number, clientY: number) => void
  onCutWire: (chipId: string, targetId: string) => void
  onContextMenu: (chipId: string, x: number, y: number) => void
  /** Corner grip dragged: new free size of the button. */
  onResize: (chipId: string, scale: number) => void
}

export function TagChipLayer({
  chips,
  scale,
  gridStep,
  counts,
  activeFilters,
  selectedId,
  selectedIds,
  grouped,
  targets,
  onSelect,
  onMove,
  onClick,
  onDelete,
  onDropOnNote,
  onWire,
  onCutWire,
  onContextMenu,
  onResize,
}: ChipLayerProps) {
  const tr = useT()
  const [dragId, setDragId] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(false)
  const live = useRef({ scale, gridStep })
  live.current = { scale, gridStep }
  const svgRef = useRef<SVGSVGElement>(null)
  /** Cable being pulled out of a jack (world coordinates of the free end). */
  const [draft, setDraft] = useState<{ chipId: string; x: number; y: number } | null>(null)

  // measured chip widths (text decides them) — needed to attach cables to the chip's edges
  const els = useRef(new Map<string, HTMLDivElement>())
  const [widths, setWidths] = useState<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    let changed = false
    const next = new Map<string, number>()
    for (const c of chips) {
      const w = els.current.get(c.id)?.offsetWidth ?? 0
      next.set(c.id, w)
      if (widths.get(c.id) !== w) changed = true
    }
    if (changed || next.size !== widths.size) setWidths(next)
  })
  const chipRect = (c: TagChip): Rect => {
    // hand-sized buttons are a normal (M) button scaled from the top-left corner
    const k = c.scale ?? 1
    return { x: c.x, y: c.y, width: (widths.get(c.id) || 140) * k, height: CHIP_H[c.scale != null ? 'm' : c.size ?? 'm'] * k }
  }

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current?.getBoundingClientRect()
    const s = live.current.scale
    return r ? { x: (cx - r.left) / s, y: (cy - r.top) / s } : { x: 0, y: 0 }
  }

  const startWire = (e: React.PointerEvent, c: TagChip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(c.id)
    setDraft({ chipId: c.id, ...toWorld(e.clientX, e.clientY) })
    document.body.classList.add('is-wiring')
    const move = (ev: PointerEvent) => setDraft({ chipId: c.id, ...toWorld(ev.clientX, ev.clientY) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('is-wiring')
      setDraft(null)
      onWire(c.id, ev.clientX, ev.clientY)
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('is-wiring')
      setDraft(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  /** Drag the corner grip: the button grows / shrinks with the pointer, keeping its proportions. */
  const startResize = (e: React.PointerEvent, c: TagChip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const el = els.current.get(c.id)
    const k0 = chipScale(c)
    // unscaled size of the button as a normal (M) one
    const baseW = (el?.offsetWidth ?? 140) * (c.scale != null ? 1 : 1 / k0)
    const w0 = baseW * k0
    const h0 = CHIP_H.m * k0
    const sx = e.clientX
    const sy = e.clientY
    document.body.classList.add('is-chip-resizing')
    const move = (ev: PointerEvent) => {
      const s = live.current.scale
      const dx = (ev.clientX - sx) / s
      const dy = (ev.clientY - sy) / s
      // project the pull onto the button's diagonal, so the corner stays under the pointer
      const k = k0 * (1 + (dx * w0 + dy * h0) / (w0 * w0 + h0 * h0))
      onResize(c.id, clampChipScale(k))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('is-chip-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, c: TagChip) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.tag-chip__remove, .tag-chip__jack, .tag-chip__grip')) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(c.id)
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return
      if (!moved) {
        setDragId(c.id)
        document.body.classList.add('is-chip-dragging')
      }
      moved = true
      const { scale: s, gridStep: g } = live.current
      const snap = ev.ctrlKey || ev.metaKey
      setSnapping(snap)
      let x = c.x + (ev.clientX - sx) / s
      let y = c.y + (ev.clientY - sy) / s
      if (snap) {
        x = snapTo(x, g)
        y = snapTo(y, g)
      }
      onMove(c.id, Math.round(x), Math.round(y))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('is-chip-dragging')
      setDragId(null)
      setSnapping(false)
      if (!moved) return onClick(c)
      if (grouped?.(c.id)) return
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const noteId = el?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId
      if (noteId) {
        onMove(c.id, c.x, c.y)
        onDropOnNote(c, noteId)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const draftChip = draft ? chips.find((c) => c.id === draft.chipId) : undefined

  return (
    <>
      <svg ref={svgRef} className="wire-layer" width="1" height="1" aria-hidden>
        {chips.flatMap((c) => {
          const from = chipRect(c)
          return (c.targets ?? []).flatMap((tid) => {
            const to = targets.get(tid)
            if (!to) return []
            const w = cable(from, to)
            return [
              <g
                key={c.id + '>' + tid}
                className={`wire${c.on ? ' is-on' : ''}${selectedId === c.id ? ' is-selected' : ''}`}
                style={{ '--chip': CHIP_COLORS[c.color] } as React.CSSProperties}
              >
                <path className="wire__hit" d={w.d} />
                <path className="wire__casing" d={w.d} />
                <path className="wire__core" d={w.d} />
                <path className="wire__current" d={w.d} />
                <circle className="wire__socket" cx={w.start[0]} cy={w.start[1]} r={4} />
                <circle className="wire__plug" cx={w.end[0]} cy={w.end[1]} r={5.5} />
                <g
                  className="wire__cut"
                  transform={`translate(${w.mid[0]} ${w.mid[1]})`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCutWire(c.id, tid)
                  }}
                >
                  <title>{tr('Від’єднати проводку')}</title>
                  <circle r={10} />
                  <path d="M-3.5 -3.5 3.5 3.5M3.5 -3.5 -3.5 3.5" />
                </g>
              </g>,
            ]
          })
        })}
        {draft && draftChip && (
          <g className="wire is-draft" style={{ '--chip': CHIP_COLORS[draftChip.color] } as React.CSSProperties}>
            {(() => {
              const w = cable(chipRect(draftChip), { x: draft.x, y: draft.y, width: 0, height: 0 })
              return (
                <>
                  <path className="wire__casing" d={w.d} />
                  <path className="wire__core" d={w.d} />
                  <circle className="wire__plug" cx={w.end[0]} cy={w.end[1]} r={5.5} />
                </>
              )
            })()}
          </g>
        )}
      </svg>
      {chips.map((c) => {
        const wired = (c.targets ?? []).some((t) => targets.has(t))
        const on = wired ? !!c.on : activeFilters.includes(c.tag)
        const fx = effectInfo(chipEffect(c))
        return (
          <div
            key={c.id}
            ref={(el) => {
              if (el) els.current.set(c.id, el)
              else els.current.delete(c.id)
            }}
            data-chip-id={c.id}
            className={`tag-chip tag-chip--canvas tag-chip--size-${c.scale != null ? 'm' : c.size ?? 'm'}${on ? ' is-active' : ''}${wired ? ' is-wired' : ''}${selectedId === c.id || selectedIds?.includes(c.id) ? ' is-selected' : ''}${dragId === c.id ? ' is-dragging' : ''}${dragId === c.id && snapping ? ' is-snapping' : ''}`}
            style={
              {
                transform: `translate(${c.x}px, ${c.y}px)${c.scale != null && c.scale !== 1 ? ` scale(${c.scale})` : ''}`,
                transformOrigin: '0 0',
                '--chip': CHIP_COLORS[c.color],
              } as React.CSSProperties
            }
            role="switch"
            aria-checked={on}
            aria-label={c.tag}
            // keyboard: Tab to it, Enter / Space switches it, Shift+F10 / Menu key opens its menu, arrows move it
            tabIndex={0}
            onFocus={(e) => {
              if (e.target === e.currentTarget && e.currentTarget.matches(':focus-visible') && selectedId !== c.id && !selectedIds?.includes(c.id)) onSelect(c.id)
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onClick(c)
              } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault()
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                onContextMenu(c.id, r.left + r.width / 2, r.bottom)
              }
            }}
            title={
              wired
                ? tr('Клік — увімкнути чи вимкнути ефект «{fx}»', { fx: tr(fx.label) })
                : tr('Клік — показати нотатки з #{tag}', { tag: c.tag })
            }
            onPointerDown={(e) => startDrag(e, c)}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSelect(c.id)
              onContextMenu(c.id, e.clientX, e.clientY)
            }}
          >
            <ChipFace tag={c.tag} count={counts.get(c.tag) ?? 0} toggle on={on} />
            <span
              className="tag-chip__jack"
              title={tr('Тягніть звідси до нотатки чи рамки — проводка')}
              onPointerDown={(e) => startWire(e, c)}
            />
            <button
              className="tag-chip__remove"
              tabIndex={-1}
              aria-label={tr('Прибрати кнопку')}
              title={tr('Прибрати кнопку')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(c.id)
              }}
            >
              <svg viewBox="0 0 10 10" width="7" height="7" aria-hidden>
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <span
              className="tag-chip__grip"
              title={tr('Тягніть, щоб змінити розмір')}
              onPointerDown={(e) => startResize(e, c)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                onResize(c.id, 1)
              }}
            />
          </div>
        )
      })}
    </>
  )
}
