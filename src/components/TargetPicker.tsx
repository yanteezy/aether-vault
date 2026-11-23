import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

/** A searchable list inside a menu: the keyboard (and click) alternative to dragging a link or a cable (WCAG 2.5.7). */
export interface PickTarget {
  id: string
  label: string
  /** Shown on the right: "нотатка" / "рамка". */
  kind?: string
}

export function TargetPicker({ items, onPick, onCancel, empty }: { items: PickTarget[]; onPick: (id: string) => void; onCancel: () => void; empty: string }) {
  const tr = useT()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const shown = items.filter((t) => !q.trim() || t.label.toLowerCase().includes(q.trim().toLowerCase()))
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.target-picker__item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div className="target-picker" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="target-picker__input"
        value={q}
        placeholder={tr('Пошук…')}
        aria-label={tr('Пошук')}
        role="combobox"
        aria-expanded="true"
        aria-controls="target-picker-list"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const d = e.key === 'ArrowDown' ? 1 : -1
            setActive((a) => (shown.length ? (a + d + shown.length) % shown.length : 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (shown[active]) onPick(shown[active].id)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="target-picker__list" id="target-picker-list" role="listbox" ref={listRef}>
        {shown.map((t, i) => (
          <div
            key={t.id}
            role="option"
            aria-selected={i === active}
            className={`target-picker__item${i === active ? ' is-active' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => onPick(t.id)}
          >
            <span className="target-picker__label">{t.label || tr('Без назви')}</span>
            {t.kind && <span className="target-picker__kind">{t.kind}</span>}
          </div>
        ))}
        {!shown.length && <div className="target-picker__empty">{empty}</div>}
      </div>
    </div>
  )
}
