import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { autoScale, manualScale, resolveFontSize, type ChecklistItem, type NoteCardData, type Side } from '../types/note'
import { useT } from '../i18n'
import { NoteFxLayer } from '../effects/NoteFx'
import type { ObjectFx } from '../effects/tagEffects'
import './NoteCard.css'

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

interface NoteCardProps {
  note: NoteCardData
  scale: number
  selected: boolean
  /** Part of a multi-selection: dragging it moves the whole group. */
  inGroup: boolean
  onToggleSelect: (id: string) => void
  dimmed: boolean
  linkTarget: boolean
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  /** Holding Ctrl/⌘ while dragging snaps the card to this world grid. */
  snapStep?: number
  onToggleChecklist: (noteId: string, itemId: string) => void
  onStartLink: (noteId: string, side: Side, e: React.PointerEvent) => void
  onResize: (id: string, width: number, height: number) => void
  /** User dragged the corner grip: new stored size (world px). */
  onResizeNote: (id: string, width: number, height: number) => void
  onDragChange: (id: string, dragging: boolean) => void
  onContextMenu: (id: string, x: number, y: number) => void
  /** Inline editing: which field gets focus, or null when not editing. */
  editing: 'title' | 'body' | null
  onStartEdit: (id: string, focus: 'title' | 'body') => void
  onEndEdit: () => void
  onUpdate: (id: string, patch: Partial<NoteCardData>) => void
  /** Detective theme: small deterministic tilt in degrees. */
  tilt: number
  /** Effects of switched-on tag buttons wired to this note. */
  fx?: ObjectFx[]
}

const MIN_W = 180
const MIN_H = 100

export function NoteCard({
  note,
  scale,
  selected,
  inGroup,
  onToggleSelect,
  dimmed,
  linkTarget,
  onSelect,
  onMove,
  snapStep = 24,
  onToggleChecklist,
  onStartLink,
  onResize,
  onResizeNote,
  onDragChange,
  onContextMenu,
  editing,
  onStartEdit,
  onEndEdit,
  onUpdate,
  tilt,
  fx,
}: NoteCardProps) {
  const tr = useT()
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState<Side | null>(null)
  const collapseOnUp = useRef(false)
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  )

  // Report real rendered size so connection anchors sit exactly on the edges.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onResize(note.id, el.offsetWidth, el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [note.id, onResize])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Ctrl/⌘ + click: add to / remove from the selection (desktop-icon style), no drag
    if ((e.ctrlKey || e.metaKey) && !editing) {
      e.stopPropagation()
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      onToggleSelect(note.id)
      return
    }
    if ((e.target as HTMLElement).closest('[data-no-drag]')) {
      // inputs / checkboxes inside the card: keep the selection, don't pan the board
      e.stopPropagation()
      onSelect(note.id)
      return
    }
    e.stopPropagation()
    // Prevent WebKit from starting a text selection / native text drag,
    // which made the card copy its text (and neighbours' on long drags).
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    // pressing a note of a multi-selection keeps the group (to drag it);
    // a plain click without moving collapses to this note on release
    collapseOnUp.current = inGroup
    if (!inGroup) onSelect(note.id)
    if (note.locked) {
      if (inGroup) onSelect(note.id)
      return
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: note.x,
      originY: note.y,
    }
    document.body.classList.add('is-dragging')
    setDragging(true)
    onDragChange(note.id, true)
  }

  // Bottom-right grip: resize in world units.
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(note.id)
    const el = ref.current
    const startX = e.clientX
    const startY = e.clientY
    const w0 = note.width
    const h0 = Math.max(note.height, el ? el.offsetHeight : note.height)
    document.body.classList.add('is-resizing')
    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_W, Math.round(w0 + (ev.clientX - startX) / scale))
      const h = Math.max(MIN_H, Math.round(h0 + (ev.clientY - startY) / scale))
      onResizeNote(note.id, w, h)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) {
      setEdge(edgeNear(e))
      return
    }
    const { startX, startY, originX, originY } = dragState.current
    if (collapseOnUp.current && Math.hypot(e.clientX - startX, e.clientY - startY) > 3) collapseOnUp.current = false
    const dx = (e.clientX - startX) / scale
    const dy = (e.clientY - startY) / scale
    let x = originX + dx
    let y = originY + dy
    if (e.ctrlKey || e.metaKey) {
      x = Math.round(x / snapStep) * snapStep
      y = Math.round(y / snapStep) * snapStep
    }
    onMove(note.id, x, y)
  }

  // Which edge is the pointer close to (in screen px)?
  const edgeNear = (e: React.PointerEvent): Side | null => {
    const el = ref.current
    if (!el) return null
    if ((e.target as HTMLElement).closest('.note-card__handle')) return edge
    const r = el.getBoundingClientRect()
    const T = 26
    const d: [Side, number][] = [
      ['top', e.clientY - r.top],
      ['bottom', r.bottom - e.clientY],
      ['left', e.clientX - r.left],
      ['right', r.right - e.clientX],
    ]
    d.sort((a, b) => a[1] - b[1])
    return d[0][1] <= T ? d[0][0] : null
  }

  const endDrag = () => {
    if (!dragState.current) return
    dragState.current = null
    if (collapseOnUp.current) {
      collapseOnUp.current = false
      onSelect(note.id)
    }
    document.body.classList.remove('is-dragging')
    setDragging(false)
    onDragChange(note.id, false)
  }

  // ---------- inline editing ----------
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const isEditing = editing !== null
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(() => {
    if (!isEditing) return
    grow(titleRef.current)
    grow(bodyRef.current)
  })
  useEffect(() => {
    if (!editing) return
    const el = editing === 'title' ? titleRef.current : bodyRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (editing === 'title') el.select()
    else el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const editKeys = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onEndEdit()
    }
  }
  const patchItem = (itemId: string, patch: Partial<ChecklistItem>) =>
    onUpdate(note.id, { checklist: note.checklist?.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) })
  const addItem = (afterId?: string) => {
    const item: ChecklistItem = { id: `ci-${Date.now()}`, label: '', done: false }
    const list = [...(note.checklist ?? [])]
    const at = afterId ? list.findIndex((i) => i.id === afterId) + 1 : list.length
    list.splice(at, 0, item)
    onUpdate(note.id, { checklist: list })
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLInputElement>(`[data-item="${item.id}"]`)?.focus(),
    )
  }
  const style = note.style ?? 'plain'
  const bodyLines = (note.body ?? '').split('\n').filter((l) => l.trim())

  return (
    <div
      ref={ref}
      data-note-id={note.id}
      data-tint={note.color && note.color !== 'default' && note.color !== 'accent' ? note.color : undefined}
      data-fx={fx?.length ? fx.map((f) => f.effect).join(' ') : undefined}
      draggable={false}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.ctrlKey && e.button === 0) return // macOS Ctrl+click = multi-select, not the menu
        if (!inGroup) onSelect(note.id)
        onContextMenu(note.id, e.clientX, e.clientY)
      }}
      onDragStart={(e) => e.preventDefault()}
      className={`note-card${selected ? ' is-selected' : ''}${inGroup ? ' is-multi' : ''}${dimmed ? ' is-dimmed' : ''}${
        note.color === 'accent' ? ' is-accent' : ''
      }${note.locked ? ' is-locked' : ''}${isEditing ? ' is-editing' : ''} note-style--${style} title-align--${
        note.titleAlign ?? 'left'
      }${linkTarget ? ' is-link-target' : ''}${dragging ? ' is-lifted' : ''}`}
      style={
        {
          transform: `translate(${note.x}px, ${note.y}px)`,
          width: note.width,
          minHeight: note.height,
          '--note-auto': autoScale(note.width, note.height),
          '--note-manual': manualScale(resolveFontSize(note.fontSize), note.width, note.height),
          '--tilt': `${tilt}deg`,
          '--fx-color': fx?.length ? fx[fx.length - 1].color : undefined,
        } as React.CSSProperties
      }
      onDoubleClick={(e) => {
        if (isEditing || (e.target as HTMLElement).closest('[data-no-drag], .note-fx__cover')) return
        e.stopPropagation()
        const onBody = !!(e.target as HTMLElement).closest('.note-card__body, .note-card__bullets')
        onStartEdit(note.id, onBody ? 'body' : 'title')
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setEdge(null)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      {SIDES.map((side) => (
        <button
          key={side}
          type="button"
          className={`note-card__handle note-card__handle--${side}${edge === side ? ' is-visible' : ''}`}
          data-no-drag
          aria-label={`Connect from ${side}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.preventDefault()
            onStartLink(note.id, side, e)
          }}
        >
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      ))}

      <div className="note-card__header">
        {isEditing ? (
          <textarea
            ref={titleRef}
            className="note-card__title note-card__input"
            data-no-drag
            rows={1}
            value={note.title}
            placeholder={tr('Назва')}
            onChange={(e) => onUpdate(note.id, { title: e.target.value.replace(/\n/g, ' ') })}
            onKeyDown={(e) => {
              editKeys(e)
              if (e.key === 'Enter') {
                e.preventDefault()
                bodyRef.current?.focus()
              }
            }}
          />
        ) : (
          <h3 className="note-card__title">{note.title}</h3>
        )}
        {note.tags.length > 0 && (
          <div className="note-card__tags">
            {note.tags.map((tag) => (
              <span key={tag} className="note-card__tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {isEditing && style !== 'banner' ? (
        <textarea
          ref={bodyRef}
          className="note-card__body note-card__input"
          data-no-drag
          rows={1}
          value={note.body ?? ''}
          placeholder={style === 'bullets' ? tr('Кожен рядок — окремий пункт') : tr('Текст нотатки…')}
          onChange={(e) => onUpdate(note.id, { body: e.target.value })}
          onKeyDown={editKeys}
        />
      ) : style === 'bullets' && bodyLines.length > 0 ? (
        <ul className="note-card__bullets">
          {bodyLines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : (
        note.body && style !== 'banner' && <p className="note-card__body">{note.body}</p>
      )}

      {note.checklist && (
        <ul className="note-card__checklist" data-no-drag>
          {note.checklist.map((item) => (
            <li key={item.id} className="note-card__checklist-item">
              <label>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => onToggleChecklist(note.id, item.id)}
                />
                {isEditing ? (
                  <input
                    className={`note-card__item-input${item.done ? ' is-done' : ''}`}
                    data-item={item.id}
                    value={item.label}
                    placeholder={tr('Пункт')}
                    onChange={(e) => patchItem(item.id, { label: e.target.value })}
                    onKeyDown={(e) => {
                      editKeys(e)
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addItem(item.id)
                      } else if (e.key === 'Backspace' && !item.label) {
                        e.preventDefault()
                        onUpdate(note.id, { checklist: note.checklist?.filter((i) => i.id !== item.id) })
                      }
                    }}
                  />
                ) : (
                  <span className={item.done ? 'is-done' : ''}>{item.label}</span>
                )}
              </label>
            </li>
          ))}
          {isEditing && (
            <li>
              <button type="button" className="note-card__add-item" onClick={() => addItem()}>
                + {tr('Пункт')}
              </button>
            </li>
          )}
        </ul>
      )}

      {note.code &&
        (isEditing ? (
          <textarea
            className="note-card__code note-card__input"
            data-no-drag
            spellCheck={false}
            value={note.code.content}
            rows={Math.max(2, note.code.content.split('\n').length)}
            onChange={(e) => onUpdate(note.id, { code: { ...note.code!, content: e.target.value } })}
            onKeyDown={editKeys}
          />
        ) : (
          <pre className="note-card__code">
            <code>{note.code.content}</code>
          </pre>
        ))}

      {note.locked ? (
        <span className="note-card__lock" title={tr('Позицію закріплено')} aria-label={tr('Закріплено')}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
            <rect x="2.5" y="5.5" width="7" height="5" rx="1.2" fill="currentColor" />
            <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
          </svg>
        </span>
      ) : (
        <div
          className="note-card__resize"
          data-no-drag
          aria-label={tr('Змінити розмір')}
          onPointerDown={startResize}
        />
      )}
      {fx?.length ? <NoteFxLayer fx={fx} /> : null}
    </div>
  )
}
