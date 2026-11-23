import { useState } from 'react'
import { useT } from '../i18n'
import { usePersistentState } from '../hooks/usePersistentState'
import { IS_MAC } from '../settings/settings'
import './FirstHints.css'

/** Three one-time tips that make the hidden parts of Aether visible. Shown once, above the dock. */
export function FirstHints() {
  const tr = useT()
  const [done, setDone] = usePersistentState('hints-done', false)
  const [step, setStep] = useState(0)
  if (done) return null
  const mod = IS_MAC ? '⌘K' : 'Ctrl K'
  const alt = IS_MAC ? '⌥' : 'Alt'
  const tips = [
    { icon: 'search', title: tr('Усі дії — в одному місці'), text: tr('Натисніть {key} або клацніть у поле внизу: кожна дія з її клавішею, пошук нотаток і створення нових.', { key: mod }) },
    { icon: 'radial', title: tr('Кругове меню'), text: tr('Утримуйте {key} будь-де на полотні, наведіть на дію й відпустіть.', { key: alt }) },
    { icon: 'click', title: tr('Правий клік — налаштування'), text: tr('Нотатки, рамки, кнопки й звʼязки мають власне меню. Кнопку зʼєднують з нотаткою кабелем із гнізда праворуч.') },
  ] as const
  const t = tips[step]
  const last = step === tips.length - 1
  return (
    <div className="first-hint" role="dialog" aria-label={t.title} key={step}>
      <div className="first-hint__icon" aria-hidden="true">
        <HintIcon name={t.icon} />
      </div>
      <div className="first-hint__body">
        <div className="first-hint__title">{t.title}</div>
        <div className="first-hint__text">{t.text}</div>
        <div className="first-hint__row">
          <span className="first-hint__dots" aria-hidden="true">
            {tips.map((_, i) => (
              <i key={i} className={i === step ? 'is-on' : ''} />
            ))}
          </span>
          <button className="first-hint__skip" onClick={() => setDone(true)}>
            {tr('Пропустити')}
          </button>
          <button className="first-hint__next" onClick={() => (last ? setDone(true) : setStep(step + 1))}>
            {last ? tr('Зрозуміло') : tr('Далі')}
          </button>
        </div>
      </div>
    </div>
  )
}

function HintIcon({ name }: { name: 'search' | 'radial' | 'click' }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  if (name === 'search')
    return (
      <svg {...p}>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5 5" />
      </svg>
    )
  if (name === 'radial')
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="2.2" />
        <circle cx="12" cy="4.5" r="1.6" />
        <circle cx="19.5" cy="12" r="1.6" />
        <circle cx="12" cy="19.5" r="1.6" />
        <circle cx="4.5" cy="12" r="1.6" />
      </svg>
    )
  return (
    <svg {...p}>
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M12 3v7M6 10h12" />
      <path d="M12 3a6 6 0 0 1 6 6v1h-6Z" fill="currentColor" opacity=".55" />
    </svg>
  )
}
