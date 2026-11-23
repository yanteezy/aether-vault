import { useEffect, useRef, useState } from 'react'
import { INK_COLORS, INK_PALETTE, type InkColor, type InkTool } from '../types/note'
import { inkStroke } from './Ink'
import { useT } from '../i18n'
import { IS_MAC } from '../settings/settings'
import './Ink.css'

const TOOLS: { id: InkTool; label: string; key: string }[] = [
  { id: 'pen', label: 'Ручка', key: 'P' },
  { id: 'marker', label: 'Маркер', key: 'M' },
  { id: 'eraser', label: 'Гумка', key: 'E' },
]

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const colorName = (c: InkColor) => INK_COLORS.find((x) => x.id === c)?.label ?? c.toUpperCase()

interface Props {
  tool: InkTool
  color: InkColor
  /** The four last-used colours, most recent first. */
  recent: InkColor[]
  onTool: (t: InkTool) => void
  onColor: (c: InkColor) => void
  canUndo: boolean
  hasStrokes: boolean
  onUndo: () => void
  onClear: () => void
  onDone: () => void
}

/** Compact glass palette shown above the Command Dock while Draw mode is on. */
export function InkToolbar({ tool, color, recent, onTool, onColor, canUndo, hasStrokes, onUndo, onClear, onDone }: Props) {
  const tr = useT()
  const [confirmClear, setConfirmClear] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!paletteOpen) return
    const away = (e: PointerEvent) => {
      if (!paletteRef.current?.contains(e.target as Node)) setPaletteOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setPaletteOpen(false)
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [paletteOpen])
  const pick = (c: InkColor) => {
    onColor(c)
    if (tool === 'eraser') onTool('pen')
  }
  const inRecent = recent.some((c) => same(c, color))
  useEffect(() => {
    if (!confirmClear) return
    const t = window.setTimeout(() => setConfirmClear(false), 2500)
    return () => window.clearTimeout(t)
  }, [confirmClear])

  return (
    <div
      className={`ink-toolbar glass-panel-strong${tool === 'eraser' ? ' is-eraser' : ''}`}
      role="toolbar"
      aria-label={tr('Малювання')}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="ink-toolbar__group" role="radiogroup" aria-label={tr('Інструмент')}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={tool === t.id}
            title={`${tr(t.label)} (${t.key})`}
            className={`ink-toolbar__tool${tool === t.id ? ' is-active' : ''}`}
            onClick={() => onTool(t.id)}
          >
            <ToolIcon kind={t.id} />
            <span>{tr(t.label)}</span>
          </button>
        ))}
      </div>

      <div className="ink-toolbar__sep" />

      <div className="ink-toolbar__group" role="radiogroup" aria-label={tr('Колір')}>
        {recent.slice(0, 4).map((c, i) => (
          <button
            key={`${c}-${i}`}
            role="radio"
            aria-checked={same(color, c)}
            aria-label={tr(colorName(c))}
            title={tr(colorName(c))}
            className={`ink-toolbar__swatch${same(color, c) ? ' is-active' : ''}`}
            style={{ '--sw': inkStroke(c) } as React.CSSProperties}
            onClick={() => pick(c)}
          />
        ))}
        <div className="ink-palette" ref={paletteRef}>
          <button
            className={`ink-toolbar__swatch ink-palette__toggle${!inRecent ? ' is-active' : ''}${paletteOpen ? ' is-open' : ''}`}
            aria-label={tr('Палітра')}
            aria-expanded={paletteOpen}
            title={tr('Палітра')}
            style={!inRecent ? ({ '--cur': inkStroke(color) } as React.CSSProperties) : undefined}
            onClick={() => setPaletteOpen((v) => !v)}
          />
          {paletteOpen && (
            <div className="ink-palette__pop glass-panel-strong" role="dialog" aria-label={tr('Палітра')}>
              <div className="ink-palette__grid">
                {INK_PALETTE.map((hex) => (
                  <button
                    key={hex}
                    className={`ink-palette__cell${same(color, hex) ? ' is-active' : ''}`}
                    style={{ '--sw': hex } as React.CSSProperties}
                    aria-label={hex}
                    title={hex.toUpperCase()}
                    onClick={() => {
                      pick(hex)
                      setPaletteOpen(false)
                    }}
                  />
                ))}
              </div>
              <label className="ink-palette__custom">
                <input
                  type="color"
                  value={color.startsWith('#') && color.length === 7 ? color : '#22d3ee'}
                  onChange={(e) => pick(e.target.value as InkColor)}
                />
                <span>{tr('Свій колір…')}</span>
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="ink-toolbar__sep" />

      <div className="ink-toolbar__group">
        <button className="ink-toolbar__tool" title={tr('Скасувати дію') + (IS_MAC ? ' (⌘Z)' : ' (Ctrl+Z)')} disabled={!canUndo} onClick={onUndo}>
          <ToolIcon kind="undo" />
          <span>{tr('Назад')}</span>
        </button>
        <button
          className={`ink-toolbar__btn${confirmClear ? ' is-danger' : ''}`}
          disabled={!hasStrokes}
          onClick={() => {
            if (!confirmClear) return setConfirmClear(true)
            setConfirmClear(false)
            onClear()
          }}
        >
          {confirmClear ? tr('Точно?') : tr('Очистити')}
        </button>
        <button className="ink-toolbar__btn is-primary" title={tr('Готово') + ' (Esc)'} onClick={onDone}>
          {tr('Готово')}
        </button>
      </div>
    </div>
  )
}

function ToolIcon({ kind }: { kind: InkTool | 'undo' }) {
  const c = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true } as const
  switch (kind) {
    case 'pen':
      return (
        <svg {...c}>
          <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M11.5 5.5l3 3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'marker':
      return (
        <svg {...c}>
          <path d="M12 3.5l4.5 4.5-6.5 6.5H5.5V10L12 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M3 17h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
        </svg>
      )
    case 'eraser':
      return (
        <svg {...c}>
          <path
            d="M7.5 16.5L3.5 12.5 11 5l5.5 5.5-6 6H7.5z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M7 9l5 5M10.5 16.5H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'undo':
      return (
        <svg {...c}>
          <path d="M7 5L3.5 8.5 7 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 8.5h7.5a4.5 4.5 0 010 9H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
  }
}
