import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteCardData } from '../types/note'
import { useT } from '../i18n'
import './QuickSearch.css'

interface QuickSearchProps {
  open: boolean
  notes: NoteCardData[]
  onPick: (note: NoteCardData) => void
  onCreate: (title: string) => void
  onClose: () => void
}

interface Hit {
  note: NoteCardData
  score: number
  snippet: string
}

function search(notes: NoteCardData[], q: string): Hit[] {
  const query = q.trim().toLowerCase()
  if (!query) return notes.slice(0, 8).map((note) => ({ note, score: 0, snippet: (note.body ?? '').slice(0, 90) }))
  const hits: Hit[] = []
  for (const note of notes) {
    const title = note.title.toLowerCase()
    const body = [note.body ?? '', ...(note.checklist ?? []).map((c) => c.label), note.code?.content ?? ''].join(' ')
    const lowerBody = body.toLowerCase()
    const tags = note.tags.join(' ').toLowerCase()
    let score = 0
    if (title.startsWith(query)) score += 100
    else if (title.includes(query)) score += 60
    if (tags.includes(query)) score += 30
    const bi = lowerBody.indexOf(query)
    if (bi >= 0) score += 20
    if (!score) continue
    const start = Math.max(0, bi - 30)
    const snippet = bi >= 0 ? (start > 0 ? '…' : '') + body.slice(start, start + 90) : body.slice(0, 90)
    hits.push({ note, score, snippet })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8)
}

function Highlight({ text, q }: { text: string; q: string }) {
  const query = q.trim()
  if (!query) return <>{text}</>
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  )
}

/** Spotlight-style palette opened with Space. */
export function QuickSearch({ open, notes, onPick, onCreate, onClose }: QuickSearchProps) {
  const tr = useT()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => search(notes, q), [notes, q])
  const canCreate = q.trim().length > 0 && !hits.some((h) => h.note.title.toLowerCase() === q.trim().toLowerCase())
  const total = hits.length + (canCreate ? 1 : 0)

  useEffect(() => {
    if (!open) return
    // focus after the open animation frame
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  const choose = (i: number) => {
    if (i < hits.length) onPick(hits[i].note)
    else if (canCreate) onCreate(q.trim())
    onClose()
  }

  return (
    <div
      className="quick-search-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="quick-search" role="dialog" aria-label={tr('Швидкий пошук')}>
        <div className="quick-search__field">
          <svg viewBox="0 0 20 20" width="20" height="20" className="quick-search__icon">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
            <line x1="14" y1="14" x2="18" y2="18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="quick-search__input"
            placeholder={tr('Шукати нотатки…')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
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
                if (total) choose(active)
              }
            }}
          />
          <kbd className="quick-search__kbd">esc</kbd>
        </div>
        {total > 0 && (
          <ul className="quick-search__results">
            {hits.map((h, i) => (
              <li
                key={h.note.id}
                className={`quick-search__item${i === active ? ' is-active' : ''}`}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => {
                  e.preventDefault()
                  choose(i)
                }}
              >
                <div className="quick-search__title">
                  <Highlight text={h.note.title} q={q} />
                </div>
                {h.snippet && (
                  <div className="quick-search__snippet">
                    <Highlight text={h.snippet} q={q} />
                  </div>
                )}
              </li>
            ))}
            {canCreate && (
              <li
                className={`quick-search__item is-create${active === hits.length ? ' is-active' : ''}`}
                onPointerEnter={() => setActive(hits.length)}
                onPointerDown={(e) => {
                  e.preventDefault()
                  choose(hits.length)
                }}
              >
                <div className="quick-search__title">{tr('Створити «{name}»', { name: q.trim() })}</div>
              </li>
            )}
          </ul>
        )}
        {total === 0 && <div className="quick-search__empty">{tr('Нічого не знайдено')}</div>}
      </div>
    </div>
  )
}
