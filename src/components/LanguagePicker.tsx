import { useState } from 'react'
import logo from '../assets/logo-ribbon.png'
import { systemLang, type Lang } from '../i18n'
import './LanguagePicker.css'

/** First launch: pick the interface language (written in both languages on purpose). */
export function LanguagePicker({ onPick }: { onPick: (lang: Lang) => void }) {
  const [hover, setHover] = useState<Lang>(systemLang())
  const options: { id: Lang; name: string; action: string; code: string }[] = [
    { id: 'en', name: 'English', action: 'Continue in English', code: 'EN' },
    { id: 'uk', name: 'Українська', action: 'Продовжити українською', code: 'UA' },
  ]
  return (
    <div className="lang-pick" role="dialog" aria-label="Choose your language · Оберіть мову">
      <div className="lang-pick__card">
        <img className="lang-pick__logo" src={logo} alt="" />
        <h1 className="lang-pick__title">Welcome to Aether</h1>
        <p className="lang-pick__subtitle">Choose your language · Оберіть мову</p>
        <div className="lang-pick__options">
          {options.map((o) => (
            <button
              key={o.id}
              className={`lang-pick__option${hover === o.id ? ' is-suggested' : ''}`}
              onMouseEnter={() => setHover(o.id)}
              onFocus={() => setHover(o.id)}
              onClick={() => onPick(o.id)}
            >
              <span className="lang-pick__code">{o.code}</span>
              <span className="lang-pick__name">{o.name}</span>
              <span className="lang-pick__action">{o.action} →</span>
            </button>
          ))}
        </div>
        <p className="lang-pick__note">You can change it later in Settings · Змінити можна в налаштуваннях</p>
      </div>
    </div>
  )
}
