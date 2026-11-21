import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FRAME_COLORS, type Frame } from '../types/note'
import { useT } from '../i18n'
import { FRAME_MIN_H, FRAME_MIN_W } from './Frames'
import './NoteMenu.css'
import './FrameMenu.css'

const FRAME_MAX = 9999

export interface FrameMenuActions {
  onPatch: (patch: Partial<Frame>) => void
  onFit: () => void
  onSelectNotes: () => void
  onDuplicate: () => void
  onDelete: () => void
}

interface Props extends FrameMenuActions {
  frame: Frame
  at: { x: number; y: number }
  /** Notes whose centre is inside the frame. */
  count: number
  onClose: () => void
}

/** Right-click menu of a frame — same look and layout as the note menu. */
export function FrameMenu({ frame: f, at, count, onClose, ...a }: Props) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState(f.title)
  useEffect(() => setName(f.title), [f.title])

  // keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    let x = at.x
    let y = at.y
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, at.x - r.width)
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - pad - r.height)
    setPos({ x, y })
  }, [at])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const close = () => onClose()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('wheel', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const commitName = () => {
    const t = name.trim()
    if (t !== f.title) a.onPatch({ title: t })
  }

  return (
    <div
      ref={ref}
      className="note-menu frame-menu"
      role="menu"
      aria-label={tr('Налаштування рамки')}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="note-menu__title" title={f.title}>
        {f.title || tr('Група')}
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Назва')}</span>
        <input
          className="frame-menu__name"
          value={name}
          maxLength={80}
          placeholder={tr('Група')}
          aria-label={tr('Назва рамки')}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setName(f.title)
              onClose()
            }
          }}
        />
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Розмір')}</span>
        <div className="note-menu__dims">
          <NumField
            label={tr('Ш')}
            title={tr('Ширина, px')}
            value={Math.round(f.width)}
            min={FRAME_MIN_W}
            disabled={f.locked}
            onChange={(width) => a.onPatch({ width })}
          />
          <span className="note-menu__times">×</span>
          <NumField
            label={tr('В')}
            title={tr('Висота, px')}
            value={Math.round(f.height)}
            min={FRAME_MIN_H}
            disabled={f.locked}
            onChange={(height) => a.onPatch({ height })}
          />
        </div>
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Колір')}</span>
        <div className="note-menu__swatches" role="radiogroup" aria-label={tr('Колір рамки')}>
          {FRAME_COLORS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={f.color === c.id}
              aria-label={tr(c.label)}
              title={tr(c.label)}
              className={`note-menu__swatch frame-menu__swatch frame-menu__swatch--${c.id}${f.color === c.id ? ' is-active' : ''}`}
              style={{ '--sw': c.rgb } as React.CSSProperties}
              onClick={() => a.onPatch({ color: c.id })}
            />
          ))}
        </div>
      </div>

      <div className="note-menu__sep" />

      <button className="note-menu__item" role="menuitem" disabled={!count || f.locked} onClick={run(a.onFit)}>
        <span>{tr('Підігнати під вміст')}</span>
      </button>
      <button className="note-menu__item" role="menuitem" disabled={!count} onClick={run(a.onSelectNotes)}>
        <span>{tr('Виділити нотатки в рамці')}</span>
        {count > 0 && <span className="note-menu__count">{count}</span>}
      </button>
      <button className="note-menu__item" role="menuitem" onClick={run(a.onDuplicate)}>
        <span>{tr('Дублювати рамку')}</span>
      </button>

      <div className="note-menu__sep" />

      <button
        className="note-menu__item"
        role="menuitemcheckbox"
        aria-checked={!!f.locked}
        onClick={run(() => a.onPatch({ locked: !f.locked }))}
      >
        <span>{f.locked ? tr('Відкріпити позицію') : tr('Закріпити позицію')}</span>
      </button>

      <div className="note-menu__sep" />

      <button
        className={`note-menu__item is-danger${confirmDelete ? ' is-confirm' : ''}`}
        role="menuitem"
        onClick={() => (confirmDelete ? run(a.onDelete)() : setConfirmDelete(true))}
      >
        <span>{confirmDelete ? tr('Натисніть ще раз, щоб видалити') : tr('Видалити рамку (нотатки залишаться)')}</span>
        {!confirmDelete && <kbd>⌫</kbd>}
      </button>
    </div>
  )
}

/** Small numeric field: type a number, ↑/↓ steps by 10 (⇧ — by 50). */
function NumField({
  label,
  title,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string
  title: string
  value: number
  min: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const clamp = (n: number) => Math.min(FRAME_MAX, Math.max(min, Math.round(n)))
  const commit = () => {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) onChange(clamp(n))
    setDraft(String(Number.isFinite(n) ? clamp(n) : value))
  }
  return (
    <label className={`note-menu__num${disabled ? ' is-disabled' : ''}`} title={title}>
      <span>{label}</span>
      <input
        inputMode="numeric"
        aria-label={title}
        disabled={disabled}
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 50 : 10)))
          }
        }}
      />
    </label>
  )
}
