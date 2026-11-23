import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CHIP_SCALE_MAX, CHIP_SCALE_MIN, chipScale, type TagChip } from '../types/note'
import { chipEffect, effectInfo, presetFor, TAG_EFFECTS } from '../effects/tagEffects'
import { useT } from '../i18n'
import { TargetPicker, type PickTarget } from './TargetPicker'
import './NoteMenu.css'
import './ChipMenu.css'

export interface ChipMenuActions {
  onPatch: (patch: Partial<TagChip>) => void
  onToggle: () => void
  onUnwire: () => void
  /** Keyboard alternative to dragging a cable: notes / frames it can be wired to. */
  wireTargets: PickTarget[]
  onWire: (targetId: string) => void
  onDelete: () => void
}

interface Props extends ChipMenuActions {
  chip: TagChip
  at: { x: number; y: number }
  /** Wires that still lead to an existing note / frame. */
  wireCount: number
  onClose: () => void
}

/** Right-click menu of a tag button: size, effect on trigger, wiring. Same look as the note menu. */
export function ChipMenu({ chip, at, wireCount, onClose, ...a }: Props) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  const [wiring, setWiring] = useState(false)
  const preset = presetFor(chip.tag)
  const effect = chipEffect(chip)
  const pct = Math.round(chipScale(chip) * 100)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // layout size, not getBoundingClientRect(): the opening animation scales the menu down,
    // which made it look shorter than it is and pushed its bottom out of the window
    const r = { width: el.offsetWidth, height: el.offsetHeight }
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

  return (
    <div
      ref={ref}
      className="note-menu chip-menu"
      role="menu"
      aria-label={tr('Налаштування кнопки')}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="note-menu__title" title={chip.tag}>
        {chip.tag}
      </div>

      <div className="note-menu__row">
        <span className="note-menu__label">{tr('Розмір')}</span>
        <input
          className="note-menu__range"
          type="range"
          min={Math.round(CHIP_SCALE_MIN * 100)}
          max={Math.round(CHIP_SCALE_MAX * 100)}
          step={5}
          value={pct}
          aria-label={tr('Розмір кнопки')}
          onChange={(e) => a.onPatch({ scale: Number(e.target.value) / 100 })}
        />
        <button
          className="chip-menu__pct"
          title={tr('Звичайний розмір')}
          onClick={() => a.onPatch({ scale: 1 })}
        >
          {pct}%
        </button>
      </div>

      <div className="note-menu__sep" />
      <div className="chip-menu__section">{tr('Ефект при вмиканні')}</div>

      {preset ? (
        <div className="chip-menu__fixed">
          <span className="chip-menu__fx-name">{tr(effectInfo(effect).label)}</span>
          <span className="chip-menu__fx-hint">{tr(effectInfo(effect).hint)}</span>
          <span className="chip-menu__fx-note">{tr('У готової кнопки ефект свій. Створіть свій тег, щоб обрати інший.')}</span>
        </div>
      ) : (
        <>
          <div className="chip-menu__effects" role="radiogroup" aria-label={tr('Ефект при вмиканні')}>
            {TAG_EFFECTS.map((fx) => (
              <button
                key={fx.id}
                role="radio"
                aria-checked={effect === fx.id}
                className={`chip-menu__fx${effect === fx.id ? ' is-active' : ''}`}
                title={tr(fx.hint)}
                onClick={() => a.onPatch({ effect: fx.id })}
              >
                <span className={`chip-menu__fx-icon chip-menu__fx-icon--${fx.id}`} aria-hidden />
                <span className="chip-menu__fx-name">{tr(fx.label)}</span>
              </button>
            ))}
          </div>
          <div className="chip-menu__fx-hint chip-menu__fx-current">{tr(effectInfo(effect).hint)}</div>
        </>
      )}

      <div className="note-menu__sep" />

      <button className="note-menu__item" role="menuitemcheckbox" aria-checked={!!chip.on} disabled={!wireCount} onClick={run(a.onToggle)}>
        <span>{chip.on ? tr('Вимкнути ефект') : tr('Увімкнути ефект')}</span>
      </button>
      <button className="note-menu__item" role="menuitem" aria-expanded={wiring} onClick={() => setWiring((v) => !v)}>
        <span>{tr('Підʼєднати до…')}</span>
      </button>
      {wiring && (
        <TargetPicker items={a.wireTargets} empty={tr('Немає нотаток чи рамок')} onCancel={() => setWiring(false)} onPick={(id) => run(() => a.onWire(id))()} />
      )}
      <button className="note-menu__item" role="menuitem" disabled={!wireCount} onClick={run(a.onUnwire)}>
        <span>{tr('Від’єднати проводку')}</span>
        {wireCount > 0 && <span className="note-menu__count">{wireCount}</span>}
      </button>
      {!wireCount && <div className="chip-menu__tip">{tr('Тягніть від гнізда кнопки до нотатки чи рамки — проводка')}</div>}

      <div className="note-menu__sep" />

      <button className="note-menu__item is-danger" role="menuitem" onClick={run(a.onDelete)}>
        <span>{tr('Прибрати кнопку')}</span>
        <kbd>⌫</kbd>
      </button>
    </div>
  )
}
