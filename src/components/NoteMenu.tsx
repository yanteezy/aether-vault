import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { autoScale, resolveFontSize, type NoteCardData, type NoteColor, type NoteStyle, type TitleAlign } from '../types/note'
import { FontSizeControl } from './FontSizePicker'
import { NoteFontPicker } from './FontPicker'
import { useT } from '../i18n'
import './NoteMenu.css'

const NOTE_MIN_W = 180
const NOTE_MIN_H = 100
const NOTE_MAX = 2000

const NOTE_STYLES: { id: NoteStyle; label: string; hint: string }[] = [
  { id: 'plain', label: 'Звичайна', hint: 'Назва і текст' },
  { id: 'headline', label: 'Заголовок', hint: 'Велика назва, нижче звичайний рядок' },
  { id: 'caps', label: 'ЗАГЛАВНІ', hint: 'Назва великими літерами з лінією' },
  { id: 'banner', label: 'Банер', hint: 'Тільки велика назва' },
  { id: 'quote', label: 'Цитата', hint: 'Текст курсивом, назва — підпис' },
  { id: 'bullets', label: 'Список', hint: 'Кожен рядок тексту — пункт' },
]

const ALIGNS: { id: TitleAlign; label: string; path: string }[] = [
  { id: 'left', label: 'Ліворуч', path: 'M2 3h10M2 7h6M2 11h8' },
  { id: 'center', label: 'По центру', path: 'M2 3h10M4 7h6M3 11h8' },
  { id: 'right', label: 'Праворуч', path: 'M2 3h10M6 7h6M4 11h8' },
]

const NOTE_COLORS: { id: NoteColor; label: string }[] = [
  { id: 'default', label: 'Без кольору' },
  { id: 'accent', label: 'Акцент' },
  { id: 'yellow', label: 'Жовтий' },
  { id: 'green', label: 'Зелений' },
  { id: 'blue', label: 'Синій' },
  { id: 'pink', label: 'Рожевий' },
  { id: 'purple', label: 'Фіолетовий' },
  { id: 'gray', label: 'Сірий' },
]

export interface NoteMenuActions {
  onEdit: () => void
  onPatch: (patch: Partial<NoteCardData>) => void
  onDuplicate: () => void
  onCopyText: () => Promise<boolean>
  onFront: () => void
  onBack: () => void
  onOpenInList: () => void
  onUnlink: () => void
  onDelete: () => void
}

interface Props extends NoteMenuActions {
  note: NoteCardData
  at: { x: number; y: number }
  linkCount: number
  onClose: () => void
  /** Global card body text size, px. */
  baseFontPx: number
  /** Global «Авторозмір тексту» switch. */
  autoTextDefault: boolean
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

export function NoteMenu({ note, at, linkCount, onClose, baseFontPx, autoTextDefault, ...a }: Props) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
  const font = resolveFontSize(note.fontSize) ?? (autoTextDefault ? 'auto' : undefined)
  const shownPx = font === 'auto' ? baseFontPx * autoScale(note.width, note.height) : baseFontPx
  const color = note.color ?? 'default'
  const nstyle = note.style ?? 'plain'
  const align = note.titleAlign ?? 'left'

  return (
    <div
      ref={ref}
      className="note-menu"
      role="menu"
      aria-label={tr('Налаштування нотатки')}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="note-menu__title" title={note.title}>
        {note.title || tr('Без назви')}
      </div>

      <button className="note-menu__item" role="menuitem" onClick={run(a.onEdit)}>
        <span>{tr('Редагувати')}</span>
        <kbd>↩</kbd>
      </button>

      <div className="note-menu__sep" />

      <div className="note-menu__styles" role="radiogroup" aria-label={tr('Тип нотатки')}>
        {NOTE_STYLES.map((st) => (
          <button
            key={st.id}
            role="radio"
            aria-checked={nstyle === st.id}
            title={tr(st.hint)}
            className={`note-menu__style note-menu__style--${st.id}${nstyle === st.id ? ' is-active' : ''}`}
            onClick={() => a.onPatch({ style: st.id })}
          >
            <span className="note-menu__style-glyph" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="note-menu__style-label">{tr(st.label)}</span>
          </button>
        ))}
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Назва')}</span>
        <div className="note-menu__seg" role="radiogroup" aria-label={tr('Вирівнювання назви')}>
          {ALIGNS.map((al) => (
            <button
              key={al.id}
              role="radio"
              aria-checked={align === al.id}
              aria-label={tr(al.label)}
              title={tr(al.label)}
              className={align === al.id ? 'is-active' : ''}
              onClick={() => a.onPatch({ titleAlign: al.id })}
            >
              <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden>
                <path d={al.path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="note-menu__block">
        <span className="note-menu__label">{tr('Розмір тексту')}</span>
        <FontSizeControl
          value={font}
          shownPx={shownPx}
          allowAuto
          onChange={(v) => a.onPatch({ fontSize: v })}
        />
      </div>

      <div className="note-menu__block">
        <span className="note-menu__label">{tr('Шрифт')}</span>
        <NoteFontPicker withDefault value={note.font} onChange={(font) => a.onPatch({ font })} />
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Розмір')}</span>
        <div className="note-menu__dims">
          <NumField
            label={tr('Ш')}
            title={tr('Ширина, px')}
            value={Math.round(note.width)}
            min={NOTE_MIN_W}
            disabled={note.locked}
            onChange={(width) => a.onPatch({ width })}
          />
          <span className="note-menu__times">×</span>
          <NumField
            label={tr('В')}
            title={tr('Висота, px')}
            value={Math.round(note.height)}
            min={NOTE_MIN_H}
            disabled={note.locked}
            onChange={(height) => a.onPatch({ height })}
          />
        </div>
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Колір')}</span>
        <div className="note-menu__swatches" role="radiogroup" aria-label={tr('Колір нотатки')}>
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={color === c.id}
              aria-label={tr(c.label)}
              title={tr(c.label)}
              className={`note-menu__swatch note-menu__swatch--${c.id}${color === c.id ? ' is-active' : ''}`}
              onClick={() => a.onPatch({ color: c.id })}
            />
          ))}
        </div>
      </div>

      <div className="note-menu__sep" />

      <button className="note-menu__item" role="menuitem" onClick={run(a.onDuplicate)}>
        <span>{tr('Дублювати')}</span>
        <kbd>{mod}D</kbd>
      </button>
      <button
        className="note-menu__item"
        role="menuitem"
        onClick={() =>
          void a.onCopyText().then((ok) => {
            if (!ok) return onClose()
            setCopied(true)
            window.setTimeout(onClose, 650)
          })
        }
      >
        <span>{copied ? tr('Скопійовано ✓') : tr('Копіювати текст')}</span>
      </button>
      <button className="note-menu__item" role="menuitem" onClick={run(a.onOpenInList)}>
        <span>{tr('Відкрити в «Нотатки»')}</span>
      </button>

      <div className="note-menu__sep" />

      <button className="note-menu__item" role="menuitem" onClick={run(a.onFront)}>
        <span>{tr('На передній план')}</span>
      </button>
      <button className="note-menu__item" role="menuitem" onClick={run(a.onBack)}>
        <span>{tr('На задній план')}</span>
      </button>
      <button
        className="note-menu__item"
        role="menuitemcheckbox"
        aria-checked={!!note.locked}
        onClick={run(() => a.onPatch({ locked: !note.locked }))}
      >
        <span>{note.locked ? tr('Відкріпити позицію') : tr('Закріпити позицію')}</span>
      </button>
      <button className="note-menu__item" role="menuitem" disabled={!linkCount} onClick={run(a.onUnlink)}>
        <span>{tr('Від’єднати зв’язки')}</span>
        {linkCount > 0 && <span className="note-menu__count">{linkCount}</span>}
      </button>

      <div className="note-menu__sep" />

      <button
        className={`note-menu__item is-danger${confirmDelete ? ' is-confirm' : ''}`}
        role="menuitem"
        onClick={() => (confirmDelete ? run(a.onDelete)() : setConfirmDelete(true))}
      >
        <span>{confirmDelete ? tr('Натисніть ще раз, щоб видалити') : tr('Видалити')}</span>
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
  const set = (n: number) => onChange(Math.min(NOTE_MAX, Math.max(min, Math.round(n))))
  const commit = () => {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) set(n)
    setDraft(String(Number.isFinite(n) ? Math.min(NOTE_MAX, Math.max(min, n)) : value))
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
            set(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 50 : 10))
          }
        }}
      />
    </label>
  )
}
