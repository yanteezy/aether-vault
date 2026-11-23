import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { IS_MAC } from '../settings/settings'
import './CommandPalette.css'

/**
 * Opens above the dock while its field is focused (Ctrl/⌘K): every action with its shortcut, matching notes,
 * and "create a note" — so nothing in Aether has to be remembered or discovered by accident.
 */
export interface PaletteCommand {
  id: string
  label: string
  group: string
  /** Shortcut shown on the right. */
  keys?: string
  /** Extra words to match (both languages). */
  words?: string
  disabled?: boolean
  run: () => void
}
export interface PaletteNote {
  id: string
  title: string
  snippet: string
}

interface Props {
  open: boolean
  query: string
  commands: PaletteCommand[]
  notes: PaletteNote[]
  onPickNote: (id: string) => void
  onCreate: (title: string) => void
  onClose: () => void
  /** Keyboard comes from the dock's input; the palette only renders. */
  keyRef: React.MutableRefObject<((e: React.KeyboardEvent) => boolean) | null>
}

type Item = { kind: 'cmd'; c: PaletteCommand } | { kind: 'note'; n: PaletteNote } | { kind: 'create'; title: string }

const norm = (s: string) => s.toLowerCase().replace(/[’'ʼ]/g, '')

export function CommandPalette({ open, query, commands, notes, onPickNote, onCreate, onClose, keyRef }: Props) {
  const tr = useT()
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const q = norm(query.trim())

  const items: Item[] = useMemo(() => {
    const cmds = commands.filter((c) => !c.disabled && (!q || norm(`${c.label} ${c.words ?? ''} ${c.group}`).includes(q)))
    const out: Item[] = []
    if (q) {
      // a query that starts an action's name ("граф", "нал…") means the action: put actions first
      const actionFirst = cmds.some((c) => norm(c.label).startsWith(q) || norm(c.label).includes(' ' + q))
      if (actionFirst) for (const c of cmds.slice(0, 6)) out.push({ kind: 'cmd', c })
      for (const n of notes.slice(0, 5)) out.push({ kind: 'note', n })
      if (!actionFirst) for (const c of cmds.slice(0, 6)) out.push({ kind: 'cmd', c })
      if (!notes.some((n) => norm(n.title) === q)) out.push({ kind: 'create', title: query.trim() })
    } else for (const c of cmds) out.push({ kind: 'cmd', c })
    return out
  }, [commands, notes, q, query])

  useEffect(() => setActive(0), [q, open])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.palette__item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const runItem = (it: Item | undefined) => {
    if (!it) return
    onClose()
    if (it.kind === 'cmd') it.c.run()
    else if (it.kind === 'note') onPickNote(it.n.id)
    else onCreate(it.title)
  }
  keyRef.current = open
    ? (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const d = e.key === 'ArrowDown' ? 1 : -1
          setActive((a) => (items.length ? (a + d + items.length) % items.length : 0))
          return true
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          runItem(items[active])
          return true
        }
        return false
      }
    : null

  if (!open) return null

  let lastGroup = ''
  return (
    <div className="palette" role="listbox" aria-label={tr('Команди')} onMouseDown={(e) => e.preventDefault()}>
      <div className="palette__list" ref={listRef}>
        {items.map((it, i) => {
          const head =
            it.kind === 'cmd' ? (q ? tr('Дії') : it.c.group) : it.kind === 'note' ? tr('Нотатки') : ''
          const showHead = head && head !== lastGroup
          if (head) lastGroup = head
          return (
            <div key={it.kind === 'cmd' ? it.c.id : it.kind === 'note' ? 'n-' + it.n.id : 'create'}>
              {showHead && <div className="palette__group">{head}</div>}
              <div
                role="option"
                aria-selected={i === active}
                className={`palette__item${i === active ? ' is-active' : ''}${it.kind === 'create' ? ' is-create' : ''}`}
                onMouseMove={() => setActive(i)}
                onClick={() => runItem(it)}
              >
                {it.kind === 'cmd' && (
                  <>
                    <span className="palette__label">{it.c.label}</span>
                    {it.c.keys && <kbd className="palette__kbd">{it.c.keys}</kbd>}
                  </>
                )}
                {it.kind === 'note' && (
                  <>
                    <span className="palette__label">
                      {it.n.title || tr('Без назви')}
                      {it.n.snippet && <span className="palette__snippet">{it.n.snippet}</span>}
                    </span>
                    <span className="palette__tag">{tr('Перейти')}</span>
                  </>
                )}
                {it.kind === 'create' && (
                  <span className="palette__label">
                    <span className="palette__plus">+</span> {tr('Створити нотатку «{name}»', { name: it.title })}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {!items.length && <div className="palette__empty">{tr('Нічого не знайдено')}</div>}
      </div>
      <div className="palette__foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {tr('вибір')}
        </span>
        <span>
          <kbd>Enter</kbd> {tr('виконати')}
        </span>
        <span className="palette__tip">
          {tr('Утримуйте {key} — кругове меню · правий клік — налаштування об’єкта', { key: IS_MAC ? '⌥' : 'Alt' })}
        </span>
      </div>
    </div>
  )
}
