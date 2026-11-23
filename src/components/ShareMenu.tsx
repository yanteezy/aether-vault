import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { usePersistentState } from '../hooks/usePersistentState'
import { backupFileName, createBackup, revealFile, saveBackupFile } from '../features/backup'
import { copyText, generatePassword, LONG_LINK, makeShareLink, type SharedBoard } from '../features/share'
import type { WorkspaceApi } from '../Workspace'
import type { CanvasBg, ThemeId } from '../settings/settings'
import { IS_MAC } from '../settings/settings'
import './ShareMenu.css'

/**
 * Top-right "Share" popover: copy a link to the board (or the selection), optionally locked with a password,
 * without private notes, with the theme; or save this board as an .aether file (with photos).
 */
interface Props {
  open: boolean
  anchor: HTMLElement | null
  onClose: () => void
  api: React.MutableRefObject<WorkspaceApi | null>
  /** Bumped by Ctrl/⌘+Shift+C: copy the link right away. */
  copyNonce: number
  vaultId: string
  vaultName: string
  theme: ThemeId
  canvasBg: CanvasBg
}

type Status = { kind: 'ok' | 'warn' | 'error'; text: string; path?: string } | null

export function ShareMenu({ open, anchor, onClose, api, copyNonce, vaultId, vaultName, theme, canvasBg }: Props) {
  const tr = useT()
  const [opts, setOpts] = usePersistentState('share-options', { skipPrivate: true, withTheme: false })
  const [selection, setSelection] = useState(false)
  const [lock, setLock] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [pos, setPos] = useState({ top: 52, right: 12 })
  const [counts, setCounts] = useState({ notes: 0, selected: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)
  useFocusTrap(ref, open, '.share-menu__cta')

  // each time it opens: fresh counts, selection only if something is selected
  useLayoutEffect(() => {
    if (!open) return
    const sel = api.current?.selectionSize() ?? 0
    const all = api.current?.shareSnapshot({ selection: false, skipPrivate: false }).notes.length ?? 0
    setCounts({ notes: all, selected: sel })
    setSelection(sel > 0)
    setStatus(null)
    if (anchor) {
      const r = anchor.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right - 6) })
    }
  }, [open, anchor, api])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open, anchor, onClose])

  // Ctrl/⌘+Shift+C: open + copy at once (after the counts above are in)
  const copyRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    if (!copyNonce) return
    const id = window.setTimeout(() => void copyRef.current(), 0)
    return () => window.clearTimeout(id)
  }, [copyNonce])

  // how long the link will be — known before copying, so a too-long link can be avoided (the .aether file instead)
  const [linkLen, setLinkLen] = useState<number | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    const id = window.setTimeout(async () => {
      const snap = api.current?.shareSnapshot({ selection, skipPrivate: opts.skipPrivate })
      if (!snap) return
      try {
        const plain = await makeShareLink({
          v: 1,
          name: vaultName,
          notes: snap.notes,
          connections: snap.connections,
          frames: snap.frames,
          chips: snap.chips,
          strokes: snap.strokes,
          ...(opts.withTheme ? { theme: { theme, canvasBg } } : {}),
        })
        // a password adds salt + iv + tag (44 bytes → ~60 characters)
        if (alive) setLinkLen(plain.length + (lock ? 60 : 0))
      } catch {
        if (alive) setLinkLen(null)
      }
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [open, selection, opts, lock, vaultName, theme, canvasBg, api])

  if (!open) return null
  const tooLong = linkLen !== null && linkLen > LONG_LINK

  const board = (): { board: SharedBoard; skipped: number; photos: number } | null => {
    const snap = api.current?.shareSnapshot({ selection, skipPrivate: opts.skipPrivate })
    if (!snap) return null
    return {
      board: {
        v: 1,
        name: vaultName,
        notes: snap.notes,
        connections: snap.connections,
        frames: snap.frames,
        chips: snap.chips,
        strokes: snap.strokes,
        ...(opts.withTheme ? { theme: { theme, canvasBg } } : {}),
      },
      skipped: snap.privateSkipped,
      photos: snap.photos,
    }
  }

  const copyLink = async () => {
    if (lock && password.trim().length < 4) {
      setStatus({ kind: 'error', text: tr('Пароль — щонайменше 4 символи') })
      pwRef.current?.focus()
      return
    }
    const b = board()
    if (!b) return
    if (!b.board.notes.length && !b.board.frames.length && !b.board.strokes.length && !b.board.chips.length) {
      setStatus({ kind: 'error', text: tr('Немає чого поширювати') })
      return
    }
    setBusy(true)
    try {
      const link = await makeShareLink(b.board, lock ? password.trim() : undefined)
      await copyText(link)
      const notes = [
        lock ? tr('Пароль передайте окремо') : '',
        b.photos ? tr('Фото не входять у посилання — для них є файл .aether') : '',
        link.length > LONG_LINK ? tr('Посилання довге — деякі месенджери можуть його обрізати') : '',
      ].filter(Boolean)
      setStatus({ kind: notes.length > (lock ? 1 : 0) ? 'warn' : 'ok', text: [tr('Посилання скопійовано'), ...notes].join(' · ') })
    } catch {
      setStatus({ kind: 'error', text: tr('Не вдалося створити посилання') })
    } finally {
      setBusy(false)
    }
  }

  copyRef.current = copyLink

  const saveFile = async () => {
    setBusy(true)
    try {
      const b = await createBackup(['notes'], vaultId)
      const path = await saveBackupFile(backupFileName(vaultName), JSON.stringify(b))
      setStatus({ kind: 'ok', text: path ? tr('Збережено в «Завантаження»') : tr('Файл завантажено'), path: path ?? undefined })
    } catch {
      setStatus({ kind: 'error', text: tr('Не вдалося зберегти файл') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className="share-menu"
      role="dialog"
      aria-label={tr('Поширити дошку')}
      style={{ top: pos.top, right: pos.right }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="share-menu__head">
        <span>{tr('Поширити дошку')}</span>
        <span className="share-menu__sub">{tr('нотаток: {n}', { n: counts.notes })}</span>
      </div>

      <button className="share-menu__cta" disabled={busy} onClick={() => void copyLink()}>
        <Icon name="link" />
        {selection ? tr('Скопіювати посилання на виділене') : tr('Скопіювати посилання')}
        <span className="share-menu__kbd">{IS_MAC ? '⇧⌘C' : 'Ctrl+Shift+C'}</span>
      </button>
      {linkLen !== null && (
        <div className={`share-menu__size${tooLong ? ' is-long' : ''}`}>
          {tooLong
            ? tr('≈ {n} символів — задовге для деяких месенджерів. Надійніше надіслати файл .aether', { n: linkLen.toLocaleString() })
            : tr('≈ {n} символів', { n: linkLen.toLocaleString() })}
        </div>
      )}

      {counts.selected > 0 && (
        <Row icon="select" label={tr('Лише виділене')} extra={`· ${counts.selected}`} on={selection} onToggle={() => setSelection((v) => !v)} />
      )}

      <div className="share-menu__sep" />

      <Row
        icon="lock"
        label={tr('Захистити паролем')}
        hint={tr('без пароля дошку не відкрити')}
        on={lock}
        onToggle={() => {
          setLock((v) => !v)
          setStatus(null)
          window.setTimeout(() => pwRef.current?.focus(), 30)
        }}
      />
      {lock && (
        <div className="share-menu__pw">
          <input
            ref={pwRef}
            className="share-menu__input"
            type={showPw ? 'text' : 'password'}
            value={password}
            placeholder={tr('Пароль')}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(e) => {
              setPassword(e.target.value)
              setStatus(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void copyLink()
            }}
          />
          <button className="share-menu__mini" aria-label={showPw ? tr('Сховати пароль') : tr('Показати пароль')} title={showPw ? tr('Сховати пароль') : tr('Показати пароль')} onClick={() => setShowPw((v) => !v)}>
            <Icon name={showPw ? 'eye-off' : 'eye'} />
          </button>
          <button
            className="share-menu__mini"
            onClick={() => {
              setPassword(generatePassword())
              setShowPw(true)
              setStatus(null)
            }}
          >
            {tr('Згенерувати')}
          </button>
        </div>
      )}
      <Row icon="eye-off" label={tr('Без особистих нотаток')} on={opts.skipPrivate} onToggle={() => setOpts((o) => ({ ...o, skipPrivate: !o.skipPrivate }))} />
      <Row icon="palette" label={tr('Разом з темою')} on={opts.withTheme} onToggle={() => setOpts((o) => ({ ...o, withTheme: !o.withTheme }))} />

      <div className="share-menu__sep" />

      <button className={`share-menu__row share-menu__row--plain${tooLong ? ' is-suggested' : ''}`} disabled={busy} onClick={() => void saveFile()}>
        <Icon name="file" />
        <span className="share-menu__label">
          {tr('Файл .aether')}
          <span className="share-menu__sub">{tr('уся дошка разом з фото')}</span>
        </span>
      </button>

      {status && (
        <div className={`share-menu__status is-${status.kind}`} role="status">
          {status.text}
          {status.path && (
            <button className="share-menu__link" onClick={() => void revealFile(status.path!)}>
              {tr('Показати в папці')}
            </button>
          )}
        </div>
      )}
      <div className="share-menu__foot">{tr('Отримали посилання? Вставте його в Aether ({key})', { key: IS_MAC ? '⌘V' : 'Ctrl+V' })}</div>
    </div>
  )
}

function Row({ icon, label, hint, extra, on, onToggle }: { icon: IconName; label: string; hint?: string; extra?: string; on: boolean; onToggle: () => void }) {
  return (
    <button className="share-menu__row" role="switch" aria-checked={on} onClick={onToggle}>
      <Icon name={icon} />
      <span className="share-menu__label">
        {label}
        {extra && <span className="share-menu__count"> {extra}</span>}
        {hint && <span className="share-menu__sub">{hint}</span>}
      </span>
      <span className={`share-menu__switch${on ? ' is-on' : ''}`} aria-hidden="true" />
    </button>
  )
}

type IconName = 'link' | 'select' | 'lock' | 'eye' | 'eye-off' | 'palette' | 'file' | 'share' | 'shield'
export function Icon({ name }: { name: IconName }) {
  const p = { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
  switch (name) {
    case 'link':
      return (
        <svg {...p}>
          <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1" />
          <path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
        </svg>
      )
    case 'select':
      return (
        <svg {...p}>
          <path d="M4 7V5a1 1 0 0 1 1-1h2M13 4h2a1 1 0 0 1 1 1v2M16 13v2a1 1 0 0 1-1 1h-2M7 16H5a1 1 0 0 1-1-1v-2" />
          <rect x="7.5" y="7.5" width="5" height="5" rx="1" />
        </svg>
      )
    case 'lock':
      return (
        <svg {...p}>
          <rect x="4.5" y="9" width="11" height="8" rx="2" />
          <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
        </svg>
      )
    case 'eye':
      return (
        <svg {...p}>
          <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
          <circle cx="10" cy="10" r="2.5" />
        </svg>
      )
    case 'eye-off':
      return (
        <svg {...p}>
          <path d="M3 3l14 14M8.2 5a8.4 8.4 0 0 1 1.8-.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.2 2.9M5.4 6.6A13.6 13.6 0 0 0 2 10s3 5.5 8 5.5a7.6 7.6 0 0 0 3.6-.9" />
          <path d="M8.3 8.3a2.5 2.5 0 0 0 3.4 3.4" />
        </svg>
      )
    case 'palette':
      return (
        <svg {...p}>
          <path d="M10 2.5a7.5 7.5 0 0 0 0 15c1 0 1.5-.7 1.5-1.4 0-.9-.8-1.2-.8-2.1 0-.8.6-1.5 1.5-1.5h1.6a3.7 3.7 0 0 0 3.7-3.7C17.5 5.4 14.1 2.5 10 2.5Z" />
          <circle cx="6.5" cy="9" r=".8" fill="currentColor" />
          <circle cx="9" cy="6" r=".8" fill="currentColor" />
          <circle cx="12.8" cy="6.8" r=".8" fill="currentColor" />
        </svg>
      )
    case 'file':
      return (
        <svg {...p}>
          <path d="M11.5 2.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5l-4-4Z" />
          <path d="M11.5 2.5v4h4M7.5 11h5M7.5 14h3" />
        </svg>
      )
    case 'share':
      return (
        <svg {...p}>
          <circle cx="14.5" cy="5" r="2.2" />
          <circle cx="5.5" cy="10" r="2.2" />
          <circle cx="14.5" cy="15" r="2.2" />
          <path d="M7.5 9l5-2.8M7.5 11l5 2.8" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...p} width={22} height={22}>
          <path d="M10 2.5l6 2.2v4.6c0 3.9-2.6 6.9-6 8.2-3.4-1.3-6-4.3-6-8.2V4.7l6-2.2Z" />
          <rect x="7.4" y="9" width="5.2" height="4.2" rx="1" />
          <path d="M8.6 9V7.8a1.4 1.4 0 0 1 2.8 0V9" />
        </svg>
      )
  }
}
