import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { searchAll, type FoundNote } from '../features/globalSearch'
import type { Vault } from '../types/note'
import './QuickSearch.css'

const DELAY = 120

/** Search over every workspace, opened with Ctrl+Space. Looks like the quick search (Space). */
export function GlobalSearch({ vaults, onPick, onClose }: { vaults: Vault[]; onPick: (note: FoundNote) => void; onClose: () => void }) {
  const tr = useT()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; notes: FoundNote[] }>({ query: '', notes: [] })
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => before?.focus?.()
  }, [])

  useEffect(() => {
    // answers may come back out of order: only the one for the current text counts
    let current = true
    const timer = window.setTimeout(() => {
      void searchAll(query, vaults).then((notes) => {
        if (!current) return
        setFound({ query, notes })
        setActive(0)
      })
    }, DELAY)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [query, vaults])

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const notes = found.notes
  const total = notes.length
  const choose = (i: number) => {
    if (!notes[i]) return
    onPick(notes[i])
    onClose()
  }
  const nameOf = (id: string) => vaults.find((v) => v.id === id)?.name ?? ''
  const answered = found.query === query && query.trim() !== ''

  return (
    <div
      className="quick-search-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="quick-search" role="dialog" aria-modal="true" aria-label={tr('Пошук в усіх сховищах')}>
        <div className="quick-search__field">
          <svg viewBox="0 0 20 20" width="20" height="20" className="quick-search__icon" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
            <line x1="14" y1="14" x2="18" y2="18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="quick-search__input"
            role="combobox"
            aria-label={tr('Пошук в усіх сховищах')}
            aria-expanded={total > 0}
            aria-controls="global-search-results"
            aria-activedescendant={total ? `global-search-${active}` : undefined}
            placeholder={tr('Пошук в усіх сховищах')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => (total ? (a + 1) % total : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => (total ? (a - 1 + total) % total : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(active)
              } else if (e.key === 'Tab') {
                // the only control of the dialog: focus stays in it
                e.preventDefault()
              }
            }}
          />
          <kbd className="quick-search__kbd">esc</kbd>
        </div>
        <ul className="quick-search__results" id="global-search-results" role="listbox" aria-label={tr('Результати')} ref={listRef} hidden={!total}>
          {notes.map((n, i) => (
            <li
              key={`${n.vaultId}:${n.noteId}`}
              id={`global-search-${i}`}
              role="option"
              aria-selected={i === active}
              className={`quick-search__item${i === active ? ' is-active' : ''}`}
              onPointerMove={() => setActive(i)}
              onPointerDown={(e) => {
                e.preventDefault()
                choose(i)
              }}
            >
              <div className="quick-search__row">
                <span className="quick-search__title">{n.title || tr('Нотатка без назви')}</span>
                <span className="quick-search__vault">{nameOf(n.vaultId)}</span>
              </div>
              {n.snippet.length > 0 && (
                <div className="quick-search__snippet">
                  {n.snippet.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {answered && !total && <div className="quick-search__empty">{tr('Нічого не знайдено')}</div>}
        <div className="sr-only" role="status">
          {answered ? tr('Знайдено: {n}', { n: total }) : ''}
        </div>
      </div>
    </div>
  )
}
