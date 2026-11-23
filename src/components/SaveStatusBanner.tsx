import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { onSaveStatus, retrySaving, saveStatus, type SaveStatus } from '../features/store'
import './DataFolder.css'

/**
 * Saving is silent while it works and loud when it does not: a failed write keeps this bar on screen
 * until the data is on disk again (the store retries on its own, with a growing pause).
 */
export function SaveStatusBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const tr = useT()
  const [s, setS] = useState<SaveStatus>(saveStatus)
  const [closeBlocked, setCloseBlocked] = useState(false)
  useEffect(() => onSaveStatus(setS), [])
  useEffect(() => {
    const f = () => setCloseBlocked(true)
    window.addEventListener('aether:close-blocked', f)
    return () => window.removeEventListener('aether:close-blocked', f)
  }, [])
  if (s.state === 'ok') return null
  const text =
    s.reason === 'full'
      ? tr('Зміни не зберігаються: на диску закінчилося місце')
      : s.reason === 'folder'
        ? tr('Зміни не зберігаються: папка даних недоступна')
        : tr('Зміни не зберігаються')
  return (
    <div className="save-banner" role="alert">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6v3.5M8 11.6v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="save-banner__text">
        {text}
        <span className="save-banner__sub">
          {closeBlocked ? tr('Якщо закрити ще раз, останні зміни буде втрачено.') : tr('Aether пробує знову. Не закривайте застосунок, доки це повідомлення не зникне.')}
        </span>
      </span>
      <button className="save-banner__btn" onClick={retrySaving}>
        {tr('Спробувати знову')}
      </button>
      <button className="save-banner__btn" onClick={onOpenSettings}>
        {tr('Папка даних')}
      </button>
    </div>
  )
}
