import type { ObjectFx } from './tagEffects'
import { useT } from '../i18n'
import './tagEffects.css'

const Lock = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="2.2" fill="none" />
  </svg>
)

const Bulb = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
    <path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.7.6 1.2V12h4v-1.1c0-.5.2-.9.6-1.2A4.5 4.5 0 0 0 8 1.5Z" fill="currentColor" />
    <path d="M6.2 13.6h3.6M6.8 15h2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

const Check = () => (
  <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden>
    <path d="M2.5 7.4 5.6 10.4 11.5 3.8" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Visual layer of the effects a note wears: badges, «to do» dashed outline, private shutter. */
export function NoteFxLayer({ fx }: { fx: ObjectFx[] }) {
  const tr = useT()
  const has = (id: ObjectFx['effect']) => fx.find((f) => f.effect === id)
  const todo = has('todo')
  const priv = has('private')
  return (
    <div className="note-fx" aria-hidden style={{ '--fx-todo': todo?.color } as React.CSSProperties}>
      {todo && (
        <svg className="note-fx__dash">
          <rect />
        </svg>
      )}
      <div className="note-fx__badges">
        {has('important') && <span className="note-fx__badge note-fx__badge--important" style={{ background: '#ff453a' }}>!</span>}
        {has('idea') && (
          <span className="note-fx__badge note-fx__badge--idea">
            <Bulb />
          </span>
        )}
        {has('question') && <span className="note-fx__badge note-fx__badge--question">?</span>}
        {has('done') && (
          <span className="note-fx__badge note-fx__badge--done">
            <Check />
          </span>
        )}
      </div>
      {priv && (
        <div className="note-fx__cover" title={tr('Зміст закрито кнопкою «{tag}»', { tag: priv.label })}>
          <Lock />
          <span>{priv.label}</span>
        </div>
      )}
    </div>
  )
}
