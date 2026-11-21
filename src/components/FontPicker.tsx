import { NOTE_FONTS, type NoteFont } from '../settings/fonts'
import { useT } from '../i18n'
import './FontPicker.css'

/**
 * «Aa» tiles, each in its own font. `withDefault` adds a first tile that means
 * «use the font from Settings» (value undefined) — for a single note.
 */
export function NoteFontPicker({
  value,
  onChange,
  withDefault,
}: {
  value: NoteFont | undefined
  onChange: (v: NoteFont | undefined) => void
  withDefault?: boolean
}) {
  const tr = useT()
  const items = withDefault
    ? [{ id: undefined, label: 'Як у налаштуваннях', stack: '' }, ...NOTE_FONTS.filter((f) => f.id !== 'auto')]
    : NOTE_FONTS
  return (
    <div className="font-tiles" role="radiogroup" aria-label={tr('Шрифт')}>
      {items.map((f) => {
        const active = value === f.id || (!withDefault && f.id === 'auto' && !value)
        return (
          <button
            key={f.id ?? 'default'}
            role="radio"
            aria-checked={active}
            title={tr(f.label)}
            className={`font-tile${active ? ' is-active' : ''}${f.stack ? '' : ' is-default'}`}
            style={f.stack ? { fontFamily: f.stack } : undefined}
            onClick={() => onChange(f.id)}
          >
            <span className="font-tile__aa">{f.stack ? 'Aa' : '•'}</span>
            <span className="font-tile__label">{tr(f.label)}</span>
          </button>
        )
      })}
    </div>
  )
}
