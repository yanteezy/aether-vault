import { useMemo, useState } from 'react'
import type { NoteCardData } from '../types/note'
import { manualScale, resolveFontSize } from '../types/note'
import { FontSizeControl } from './FontSizePicker'
import { getLang, useT } from '../i18n'
import './NotesList.css'

interface NotesListProps {
  notes: NoteCardData[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<NoteCardData>) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onToggleChecklist: (noteId: string, itemId: string) => void
  /** Global card body text size, px. */
  baseFontPx: number
}

function preview(n: NoteCardData) {
  return (n.body || n.checklist?.map((c) => c.label).join(' · ') || n.code?.content || '').slice(0, 120)
}

function when(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'uk-UA', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(getLang() === 'en' ? 'en-US' : 'uk-UA', { day: 'numeric', month: 'short' })
}

/** "Plain notes" view: list on the left, editor on the right (Apple Notes-like). */
export function NotesList({ notes, selectedId, onSelect, onUpdate, onCreate, onDelete, onToggleChecklist, baseFontPx }: NotesListProps) {
  const tr = useT()
  const [filter, setFilter] = useState('')
  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...notes]
      .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.body ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }, [notes, filter])
  const current = notes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="notes-view">
      <aside className="notes-view__list glass-panel">
        <div className="notes-view__list-head">
          <input
            className="notes-view__filter"
            placeholder={tr('Фільтр…')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="notes-view__new" onClick={onCreate} title={tr('Нова нотатка')} aria-label={tr('Нова нотатка')}>
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="notes-view__items">
          {sorted.length === 0 && <div className="notes-view__empty">{tr('Немає нотаток')}</div>}
          {sorted.map((n) => (
            <button
              key={n.id}
              className={`notes-view__item${n.id === selectedId ? ' is-active' : ''}`}
              onClick={() => onSelect(n.id)}
            >
              <div className="notes-view__item-title">{n.title || tr('Без назви')}</div>
              <div className="notes-view__item-meta">
                <span className="notes-view__item-date">{when(n.updatedAt)}</span>
                <span className="notes-view__item-preview">{preview(n) || tr('Немає тексту')}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="notes-view__editor glass-panel">
        {!current && <div className="notes-view__placeholder">{tr('Оберіть нотатку зліва або створіть нову')}</div>}
        {current && (
          <div
            className="notes-view__doc"
            style={
              {
                '--note-scale': typeof resolveFontSize(current.fontSize) === 'number'
                  ? manualScale(resolveFontSize(current.fontSize), 0, 0)
                  : 1,
              } as React.CSSProperties
            }
          >
            <div className="notes-view__toolbar">
              <FontSizeControl
                compact
                allowAuto
                value={resolveFontSize(current.fontSize) ?? 'auto'}
                shownPx={baseFontPx}
                onChange={(fontSize) => onUpdate(current.id, { fontSize })}
              />
              <button className="notes-view__delete" onClick={() => onDelete(current.id)}>
                {tr('Видалити')}
              </button>
            </div>
            <input
              className="notes-view__title"
              value={current.title}
              placeholder={tr('Назва')}
              onChange={(e) => onUpdate(current.id, { title: e.target.value })}
            />
            <input
              className="notes-view__tags"
              value={current.tags.map((t) => '#' + t).join(' ')}
              placeholder={tr('#теги')}
              onChange={(e) =>
                onUpdate(current.id, {
                  tags: e.target.value
                    .split(/[\s,]+/)
                    .map((t) => t.replace(/^#/, ''))
                    .filter(Boolean),
                })
              }
            />
            {current.checklist && (
              <ul className="notes-view__checklist">
                {current.checklist.map((item) => (
                  <li key={item.id}>
                    <label>
                      <input type="checkbox" checked={item.done} onChange={() => onToggleChecklist(current.id, item.id)} />
                      <span className={item.done ? 'is-done' : ''}>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {current.code && (
              <pre className="notes-view__code">
                <code>{current.code.content}</code>
              </pre>
            )}
            <textarea
              className="notes-view__body"
              value={current.body ?? ''}
              placeholder={tr('Почніть писати…')}
              onChange={(e) => onUpdate(current.id, { body: e.target.value })}
            />
          </div>
        )}
      </section>
    </div>
  )
}
