import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { openShareToken, type SharedBoard, type ShareToken } from '../features/share'
import { Icon } from './ShareMenu'
import './ShareMenu.css'

/** Someone's board link was opened / pasted: preview it, ask for the password if it is locked, open as a new workspace. */
export function ShareOpenDialog({ link, onOpen, onCancel }: { link: ShareToken; onOpen: (b: SharedBoard) => void; onCancel: () => void }) {
  const tr = useT()
  const [board, setBoard] = useState<SharedBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)

  // an open link is read at once; a locked one waits for the password
  useEffect(() => {
    setBoard(null)
    setError(null)
    setPassword('')
    if (link.encrypted) {
      window.setTimeout(() => pwRef.current?.focus(), 60)
      return
    }
    openShareToken(link.token)
      .then(setBoard)
      .catch((e: Error) => setError(e.message === 'unsupported' ? tr('Оновіть систему, щоб відкрити це посилання') : tr('Посилання пошкоджене або обрізане')))
  }, [link, tr])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onCancel])

  const unlockAndOpen = async () => {
    if (board) return onOpen(board)
    if (!link.encrypted) return
    if (!password) {
      pwRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      onOpen(await openShareToken(link.token, password))
    } catch (e) {
      setBusy(false)
      setError((e as Error).message === 'password' ? tr('Пароль не підходить') : tr('Посилання пошкоджене або обрізане'))
      setShake(false)
      requestAnimationFrame(() => setShake(true))
      pwRef.current?.select()
    }
  }

  const n = board?.notes.length ?? 0
  return (
    <div className="share-open" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`share-open__dlg${shake ? ' is-shake' : ''}`} role="dialog" aria-modal="true" aria-label={tr('Відкрити дошку за посиланням')} onAnimationEnd={() => setShake(false)}>
        <div className="share-open__badge-top">
          <Icon name={link.encrypted ? 'lock' : 'share'} />
        </div>
        <div className="share-open__title">{link.encrypted ? tr('Захищена дошка') : board?.name || tr('Спільна дошка')}</div>
        {!link.encrypted && board && (
          <div className="share-open__meta">
            {[
              tr('нотаток: {n}', { n }),
              board.frames.length ? tr('рамок: {n}', { n: board.frames.length }) : '',
              board.strokes.length ? tr('малюнків: {n}', { n: board.strokes.filter((s) => !s.note).length || board.strokes.length }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
        {!link.encrypted && board && n > 0 && (
          <div className="share-open__list">
            {board.notes
              .filter((x) => x.title)
              .slice(0, 5)
              .map((x) => (
                <span key={x.id} className="share-open__chip">
                  {x.title.length > 22 ? x.title.slice(0, 21) + '…' : x.title}
                </span>
              ))}
          </div>
        )}
        {link.encrypted && (
          <>
            <div className="share-open__shield">
              <Icon name="shield" />
              <div>
                <b>Protected by Aether Secure Share</b>
                <span>Encrypted with AES-256 · unlocks only with the password</span>
              </div>
            </div>
            <input
              ref={pwRef}
              className="share-open__input"
              type="password"
              value={password}
              placeholder={tr('Пароль')}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void unlockAndOpen()
              }}
            />
          </>
        )}
        {error && (
          <div className="share-open__error" role="alert">
            {error}
          </div>
        )}
        <button className="share-open__cta" disabled={busy || (!link.encrypted && !board)} onClick={() => void unlockAndOpen()}>
          {busy ? tr('Відкриваю…') : tr('Відкрити як нове сховище')}
        </button>
        <button className="share-open__cancel" onClick={onCancel}>
          {tr('Скасувати')}
        </button>
      </div>
    </div>
  )
}
