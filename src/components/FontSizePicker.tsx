import { useEffect, useState } from 'react'
import { clampFont, FONT_MAX, FONT_MIN, type NoteFontSize } from '../types/note'
import { useT } from '../i18n'
import './FontSizePicker.css'

interface FontSizeControlProps {
  /** Current value; 'auto' (or undefined = inherited) shows `shownPx` greyed out. */
  value: NoteFontSize | undefined
  /** Effective px to display when the value is automatic / inherited. */
  shownPx: number
  onChange: (v: NoteFontSize) => void
  /** Show the «Авто» switch (per-note sizes). */
  allowAuto?: boolean
  min?: number
  max?: number
  /** Narrow layout (toolbar): slider is shorter. */
  compact?: boolean
}

/**
 * Text size as numbers: [Авто] [−] [15] px [+] + a slider (10–32 px).
 * Replaces the old discrete S / M / L / XL presets.
 */
export function FontSizeControl({
  value,
  shownPx,
  onChange,
  allowAuto = false,
  min = FONT_MIN,
  max = FONT_MAX,
  compact = false,
}: FontSizeControlProps) {
  const tr = useT()
  const isManual = typeof value === 'number'
  const px = isManual ? value : Math.round(shownPx)
  const [draft, setDraft] = useState(String(px))
  useEffect(() => setDraft(String(px)), [px])

  const set = (n: number) => onChange(Math.min(max, Math.max(min, clampFont(n))))
  const commit = () => {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) set(n)
    else setDraft(String(px))
  }
  const fill = ((px - min) / (max - min)) * 100

  return (
    <div
      className={`fs-control${compact ? ' is-compact' : ''}${isManual ? '' : ' is-auto'}`}
      data-no-drag
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="fs-control__row">
        {allowAuto && (
          <button
            type="button"
            className={`fs-control__auto${value === 'auto' ? ' is-active' : ''}`}
            aria-pressed={value === 'auto'}
            title={tr('Текст змінюється разом із розміром нотатки')}
            onClick={() => onChange(value === 'auto' ? px : 'auto')}
          >
            {tr('Авто')}
          </button>
        )}
        <div className="fs-control__stepper">
          <button type="button" aria-label={tr('Менше')} disabled={px <= min} onClick={() => set(px - 1)}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <label className="fs-control__value">
            <input
              inputMode="numeric"
              aria-label={tr('Розмір тексту, px')}
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              onBlur={commit}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  commit()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setDraft(String(px))
                  e.currentTarget.blur()
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  set(px + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 4 : 1))
                }
              }}
            />
            <span>px</span>
          </label>
          <button type="button" aria-label={tr('Більше')} disabled={px >= max} onClick={() => set(px + 1)}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
              <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <input
        type="range"
        className="fs-control__slider"
        aria-label={tr('Розмір тексту')}
        min={min}
        max={max}
        step={1}
        value={px}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => set(Number(e.target.value))}
      />
    </div>
  )
}
