import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectFx } from '../effects/tagEffects'
import type { Connection, NoteCardData, Side } from '../types/note'
import type { CanvasTransform } from '../hooks/useCanvasTransform'
import { GRID, type GridStyle, type ThemeId } from '../settings/settings'
import { NoteCard } from './NoteCard'
import { ConnectionsLayer, type PendingLink } from './ConnectionsLayer'
import { anchorPoint, nearestSide, pinPoint, type Point, type Size } from './geometry'
import { CorkBackground } from './CorkBackground'
import { useT } from '../i18n'
import './CanvasBoard.css'

interface CanvasBoardProps {
  notes: NoteCardData[]
  connections: Connection[]
  transform: CanvasTransform
  selectedId: string | null
  /** All selected notes (one or many). */
  selectedIds: Set<string>
  /** Ctrl/⌘+click on a note. */
  onToggleSelect: (id: string) => void
  /** Ctrl/⌘+drag box on empty canvas. */
  onSelectMany: (ids: string[]) => void
  selectedConnectionId: string | null
  activeFilterTags: string[]
  graphMode: boolean
  grid: GridStyle
  onSelect: (id: string | null) => void
  onSelectConnection: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onToggleChecklist: (noteId: string, itemId: string) => void
  /** Drag from a "+" handle ended on another note. */
  onConnect: (from: string, fromSide: Side, to: string, toSide: Side) => void
  /** Click on "+" (at = null) or drag released on empty canvas (at = world point). */
  onCreateLinked: (from: string, fromSide: Side, at: Point | null) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onWheel: (e: React.WheelEvent) => void
  theme: ThemeId
  onResizeNote: (id: string, width: number, height: number) => void
  /** Double-click on empty canvas: new note at that world point. */
  onCreateAt: (at: Point) => void
  onNoteContextMenu: (id: string, x: number, y: number) => void
  editing: { id: string; focus: 'title' | 'body' } | null
  onStartEdit: (id: string, focus: 'title' | 'body') => void
  onEndEdit: () => void
  onUpdateNote: (id: string, patch: Partial<NoteCardData>) => void
  /** World-space layer under the notes (Smart Frames). */
  underlay?: React.ReactNode
  /** World-space layer above the notes (ink). */
  overlay?: React.ReactNode
  /** Tag buttons, drawn above the notes. */
  chipLayer?: React.ReactNode
  /** Other objects box selection can take (buttons, frames); `contain` = only when fully inside the box. */
  extraSelectables?: { id: string; x: number; y: number; width: number; height: number; contain?: boolean }[]
  /** Already selected buttons / frames (kept when the box grows). */
  extraSelected?: string[]
  /** Size of the whole selection (notes + buttons + frames): above 1 a note drags the group. */
  groupSize?: number
  /** Effects of switched-on tag buttons, per note id. */
  noteFx?: Map<string, ObjectFx[]>
  /** World grid period: Ctrl/⌘ while dragging snaps to it. */
  gridStep?: number
  /** Screen-space children inside the board (ink capture). */
  children?: React.ReactNode
  /** Name of the radial-menu key for the empty-canvas hint. */
  radialKeyLabel?: string
}

/** Stable small tilt per note (detective theme), −2°…2°. */
function tiltFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(h) % 41) - 20) / 10
}

export function CanvasBoard({
  notes,
  connections,
  transform,
  selectedId,
  selectedIds,
  onToggleSelect,
  onSelectMany,
  selectedConnectionId,
  activeFilterTags,
  graphMode,
  grid,
  onSelect,
  onSelectConnection,
  onMove,
  onToggleChecklist,
  onConnect,
  onCreateLinked,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  theme,
  onResizeNote,
  onCreateAt,
  onNoteContextMenu,
  editing,
  onStartEdit,
  onEndEdit,
  onUpdateNote,
  underlay,
  overlay,
  children,
  chipLayer,
  noteFx,
  extraSelectables,
  extraSelected,
  groupSize,
  gridStep = 24,
  radialKeyLabel = '⌥',
}: CanvasBoardProps) {
  const tr = useT()
  const strings = theme === 'detective'
  const [lifted, setLifted] = useState<string | null>(null)
  const [dropped, setDropped] = useState<string | null>(null)
  const handleDragChange = useCallback((id: string, on: boolean) => {
    setLifted(on ? id : null)
    if (!on) {
      setDropped(id)
      window.setTimeout(() => setDropped((d) => (d === id ? null : d)), 260)
    }
  }, [])
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])

  const [sizes, setSizes] = useState(() => new Map<string, Size>())
  const handleResize = useCallback((id: string, width: number, height: number) => {
    setSizes((prev) => {
      const cur = prev.get(id)
      if (cur && cur.width === width && cur.height === height) return prev
      const next = new Map(prev)
      next.set(id, { width, height })
      return next
    })
  }, [])

  // ---------- box selection (Ctrl/⌘ + drag on empty canvas, like a desktop) ----------
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const startMarquee = (e: React.PointerEvent) => {
    const base = [...selectedIds, ...(extraSelected ?? [])]
    const x0 = e.clientX
    const y0 = e.clientY
    document.body.classList.add('is-marquee')
    window.getSelection()?.removeAllRanges()
    const move = (ev: PointerEvent) => {
      const r = { x0, y0, x1: ev.clientX, y1: ev.clientY }
      setMarquee(r)
      const a = toWorld(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1))
      const b = toWorld(Math.max(r.x0, r.x1), Math.max(r.y0, r.y1))
      const { sizes: sz } = live.current
      const hit = notes
        .filter((n) => {
          const h = sz.get(n.id)?.height ?? n.height
          const w = sz.get(n.id)?.width ?? n.width
          return n.x < b.x && n.x + w > a.x && n.y < b.y && n.y + h > a.y
        })
        .map((n) => n.id)
      for (const o of extraSelectables ?? []) {
        const inside = o.contain
          ? o.x >= a.x && o.x + o.width <= b.x && o.y >= a.y && o.y + o.height <= b.y
          : o.x < b.x && o.x + o.width > a.x && o.y < b.y && o.y + o.height > a.y
        if (inside) hit.push(o.id)
      }
      onSelectMany([...base.filter((id) => !hit.includes(id)), ...hit])
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('is-marquee')
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const [pending, setPending] = useState<PendingLink | null>(null)
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null)

  // Refs so window listeners always see fresh values.
  const live = useRef({ transform, notesById, sizes, strings })
  live.current = { transform, notesById, sizes, strings }
  const cbs = useRef({ onConnect, onCreateLinked })
  cbs.current = { onConnect, onCreateLinked }
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  const toWorld = (clientX: number, clientY: number): Point => {
    const t = live.current.transform
    return { x: (clientX - t.x) / t.scale, y: (clientY - t.y) / t.scale }
  }

  const startLink = useCallback((fromId: string, side: Side, e: React.PointerEvent) => {
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    let target: { id: string; side: Side } | null = null
    document.body.classList.add('is-linking')
    window.getSelection()?.removeAllRanges()

    const resolve = (cx: number, cy: number) => {
      const p = toWorld(cx, cy)
      const el = document.elementFromPoint(cx, cy) as HTMLElement | null
      const id = el?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId
      const { notesById: byId, sizes: sz } = live.current
      if (id && id !== fromId && byId.has(id)) {
        const note = byId.get(id)!
        const s = nearestSide(note, sz.get(id), p)
        target = { id, side: s }
        const to = live.current.strings ? pinPoint(note, sz.get(id)) : anchorPoint(note, sz.get(id), s)
        return { to, toSide: s }
      }
      target = null
      return { to: p, toSide: undefined }
    }

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
      moved = true
      const r = resolve(ev.clientX, ev.clientY)
      setLinkTargetId(target?.id ?? null)
      setPending({ fromId, side, ...r })
    }

    const up = (ev: PointerEvent) => {
      finish()
      if (!moved) {
        cbs.current.onCreateLinked(fromId, side, null)
        return
      }
      resolve(ev.clientX, ev.clientY)
      const t = target as { id: string; side: Side } | null
      if (t) cbs.current.onConnect(fromId, side, t.id, t.side)
      else cbs.current.onCreateLinked(fromId, side, toWorld(ev.clientX, ev.clientY))
    }

    const cancel = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish()
    }

    function finish() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', cancel)
      document.body.classList.remove('is-linking')
      setPending(null)
      setLinkTargetId(null)
      cleanup.current = null
    }

    cleanup.current?.()
    cleanup.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', cancel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Background pattern scale: follows zoom exactly, but when zoomed far out the
  // period doubles (power of two keeps it aligned to the world origin) so the
  // pattern never collapses into noise.
  let bgScale = transform.scale
  while (bgScale < 0.5) bgScale *= 2
  const gridSize = GRID[grid].size * bgScale

  const layer = (
    <ConnectionsLayer
      connections={connections}
      notesById={notesById}
      sizes={sizes}
      emphasized={graphMode}
      selectedConnectionId={selectedConnectionId}
      pending={pending}
      strings={strings}
      onSelectConnection={(id) => {
        onSelect(null)
        onSelectConnection(id)
      }}
    />
  )

  return (
    <div
      className={`canvas-board grid-${grid}`}
      style={
        {
          '--bg-x': `${transform.x}px`,
          '--bg-y': `${transform.y}px`,
          '--bg-scale': bgScale,
          '--grid-px': `${gridSize}px`,
        } as React.CSSProperties
      }
      onContextMenu={(e) => {
        // macOS: Ctrl+click is a right-click; here it means "box / multi select"
        if (e.ctrlKey && e.button === 0) e.preventDefault()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          startMarquee(e)
          return
        }
        onSelect(null)
        onSelectConnection(null)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
        onPointerDown(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-note-id], [data-chip-id], [data-frame-id] button, .frame__header')) return
        onCreateAt(toWorld(e.clientX, e.clientY))
      }}
    >
      {theme === 'detective' && <CorkBackground transform={transform} />}
      {notes.length === 0 && !underlay && !overlay && !chipLayer && (
        <div className="canvas-board__empty">
          <div className="canvas-board__empty-title">{tr('Порожнє полотно')}</div>
          <div className="canvas-board__empty-hint">
            {tr('Двічі клацніть, щоб створити нотатку')} · <kbd>{tr('Пробіл')}</kbd> — {tr('пошук')} · {tr('затисніть')} <kbd>{radialKeyLabel}</kbd> — {tr('меню дій')}
          </div>
        </div>
      )}
      <div
        className="canvas-board__world"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        {underlay}
        {!strings && layer}
        {notes.map((note) => {
          const dimmed =
            (activeFilterTags.length > 0 &&
              !note.tags.some((t) => activeFilterTags.includes(t))) ||
            (graphMode &&
              selectedId !== null &&
              selectedId !== note.id &&
              !isConnected(note.id, selectedId, connections))
          return (
            <NoteCard
              key={note.id}
              note={note}
              scale={transform.scale}
              selected={selectedIds.has(note.id)}
              inGroup={(groupSize ?? selectedIds.size) > 1 && selectedIds.has(note.id)}
              onToggleSelect={onToggleSelect}
              dimmed={dimmed}
              linkTarget={linkTargetId === note.id}
              tilt={tiltFor(note.id)}
              fx={noteFx?.get(note.id)}
              onSelect={(id) => {
                onSelectConnection(null)
                onSelect(id)
              }}
              snapStep={gridStep}
              onMove={onMove}
              onToggleChecklist={onToggleChecklist}
              onStartLink={startLink}
              onResize={handleResize}
              onResizeNote={onResizeNote}
              onDragChange={handleDragChange}
              onContextMenu={onNoteContextMenu}
              editing={editing?.id === note.id ? editing.focus : null}
              onStartEdit={onStartEdit}
              onEndEdit={onEndEdit}
              onUpdate={onUpdateNote}
            />
          )
        })}
        {strings && layer}
        {strings &&
          notes.map((note) => {
            const p = pinPoint(note, sizes.get(note.id))
            return (
              <div
                key={note.id}
                className={`push-pin${lifted === note.id ? ' is-lifted' : ''}${dropped === note.id ? ' is-dropped' : ''}`}
                style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              >
                <span className="push-pin__shadow" />
                <span className="push-pin__needle" />
                <span className="push-pin__head" />
              </div>
            )
          })}
        {chipLayer}
        {overlay}
      </div>
      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {children}
    </div>
  )
}

function isConnected(a: string, b: string, connections: Connection[]) {
  return connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))
}
