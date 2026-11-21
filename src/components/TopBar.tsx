import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Vault } from '../types/note'
import { useT } from '../i18n'
import { IS_MAC } from '../settings/settings'
import './TopBar.css'

export type ViewMode = 'canvas' | 'list'

interface TopBarProps {
  vaults: Vault[]
  activeVaultId: string
  onSwitchVault: (id: string) => void
  onCreateVault: () => void
  onRenameVault: (id: string, name: string) => void
  onDeleteVault: (id: string) => void
  viewMode: ViewMode
  onViewMode: (m: ViewMode) => void
  onNewNote: () => void
  onOpenSettings: () => void
  zoomPercent: number
  showZoom: boolean
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Title bar: drag anywhere on empty space to move the window, double-click to zoom. */
export function TopBar({
  vaults,
  activeVaultId,
  onSwitchVault,
  onCreateVault,
  onRenameVault,
  onDeleteVault,
  viewMode,
  onViewMode,
  onNewNote,
  onOpenSettings,
  zoomPercent,
  showZoom,
}: TopBarProps) {
  const tr = useT()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // tabs that existed at first render don't play the "new tab" animation
  const [initialIds] = useState(() => new Set(vaults.map((v) => v.id)))

  // keep the active tab visible inside the strip — scroll only the strip itself
  // (scrollIntoView also scrolled the window/body and shifted the whole bar)
  useEffect(() => {
    const strip = stripRef.current
    const tab = strip?.querySelector<HTMLElement>('.vault-tab.is-active')
    if (!strip || !tab) return
    const l = tab.offsetLeft - 8
    const r = tab.offsetLeft + tab.offsetWidth + 8
    if (l < strip.scrollLeft) strip.scrollTo({ left: l, behavior: 'smooth' })
    else if (r > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: r - strip.clientWidth, behavior: 'smooth' })
  }, [activeVaultId, vaults.length])

  // fade the right edge only when tabs actually overflow
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const update = () => el.classList.toggle('is-overflowing', el.scrollWidth > el.clientWidth + 1)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [vaults.length])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !isTauri) return
    if ((e.target as HTMLElement).closest('button, input, [data-no-drag]')) return
    e.preventDefault()
    const win = getCurrentWindow()
    if (e.detail === 2) void win.toggleMaximize()
    else void win.startDragging()
  }

  return (
    <header className="top-bar" data-tauri-drag-region onMouseDown={onMouseDown}>
      <div className="top-bar__left" data-tauri-drag-region>
        <div
          className="vault-tabs"
          ref={stripRef}
          role="tablist"
          aria-label={tr('Сховища')}
          data-tauri-drag-region
          onWheel={(e) => {
            if (stripRef.current) stripRef.current.scrollLeft += e.deltaY + e.deltaX
          }}
        >
          {vaults.map((v) => {
            const isActive = v.id === activeVaultId
            const confirming = confirmDelete === v.id
            return (
              <div
                key={v.id}
                role="tab"
                aria-selected={isActive}
                className={`vault-tab${isActive ? ' is-active' : ''}${initialIds.has(v.id) ? '' : ' is-new'}`}
                data-no-drag
                title={v.name + tr(' — двічі клацніть, щоб перейменувати')}
                onMouseLeave={() => confirming && setConfirmDelete(null)}
                onMouseDown={(e) => {
                  if (e.button === 1 && vaults.length > 1) {
                    e.preventDefault()
                    setConfirmDelete(v.id)
                  }
                }}
                onClick={() => !isActive && onSwitchVault(v.id)}
                onDoubleClick={() => setEditing(v.id)}
              >
                <span className="vault-tab__glyph" aria-hidden>◆</span>
                {editing === v.id ? (
                  <input
                    className="vault-tab__rename"
                    autoFocus
                    defaultValue={v.name}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      onRenameVault(v.id, e.target.value.trim() || v.name)
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditing(null)
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="vault-tab__name">{v.name}</span>
                )}
                {vaults.length > 1 && editing !== v.id && (
                  <button
                    className={`vault-tab__close${confirming ? ' is-confirm' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirming) {
                        onDeleteVault(v.id)
                        setConfirmDelete(null)
                      } else setConfirmDelete(v.id)
                    }}
                    title={confirming ? tr('Натисніть ще раз — сховище й усі його нотатки буде видалено') : tr('Видалити сховище')}
                    aria-label={tr('Видалити сховище')}
                  >
                    {confirming ? (
                      tr('Видалити?')
                    ) : (
                      <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden>
                        <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button className="vault-tabs__add" onClick={onCreateVault} title={tr('Нове сховище')} aria-label={tr('Нове сховище')}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="top-bar__right" data-tauri-drag-region>
        <div className="top-bar__view" role="radiogroup" aria-label={tr('Вигляд')} data-no-drag>
          <button className={viewMode === 'canvas' ? 'is-active' : ''} onClick={() => onViewMode('canvas')}>
            {tr('Полотно')}
          </button>
          <button className={viewMode === 'list' ? 'is-active' : ''} onClick={() => onViewMode('list')}>
            {tr('Нотатки')}
          </button>
        </div>
        {showZoom && viewMode === 'canvas' && (
          <span className="top-bar__zoom" data-tauri-drag-region>
            {zoomPercent}%
          </span>
        )}
        <button
          className="top-bar__icon-btn"
          onClick={onOpenSettings}
          aria-label={tr('Налаштування')}
          title={tr('Налаштування') + (IS_MAC ? ' (⌘,)' : ' (Ctrl+,)')}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
            <path
              d="M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M16.2 12.1a1.3 1.3 0 0 0 .26 1.43l.05.05a1.58 1.58 0 1 1-2.23 2.23l-.05-.05a1.3 1.3 0 0 0-1.43-.26 1.3 1.3 0 0 0-.79 1.19v.14a1.58 1.58 0 1 1-3.16 0v-.07a1.3 1.3 0 0 0-.85-1.19 1.3 1.3 0 0 0-1.43.26l-.05.05a1.58 1.58 0 1 1-2.23-2.23l.05-.05a1.3 1.3 0 0 0 .26-1.43 1.3 1.3 0 0 0-1.19-.79h-.14a1.58 1.58 0 1 1 0-3.16h.07a1.3 1.3 0 0 0 1.19-.85 1.3 1.3 0 0 0-.26-1.43l-.05-.05a1.58 1.58 0 1 1 2.23-2.23l.05.05a1.3 1.3 0 0 0 1.43.26h.06a1.3 1.3 0 0 0 .79-1.19v-.14a1.58 1.58 0 1 1 3.16 0v.07a1.3 1.3 0 0 0 .79 1.19 1.3 1.3 0 0 0 1.43-.26l.05-.05a1.58 1.58 0 1 1 2.23 2.23l-.05.05a1.3 1.3 0 0 0-.26 1.43v.06a1.3 1.3 0 0 0 1.19.79h.14a1.58 1.58 0 1 1 0 3.16h-.07a1.3 1.3 0 0 0-1.19.79Z"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </button>
        <button className="top-bar__new-note" onClick={onNewNote}>
          {tr('Нова нотатка')}
        </button>
      </div>
    </header>
  )
}
