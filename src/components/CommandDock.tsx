import { forwardRef } from 'react'
import { IS_MAC } from '../settings/settings'
import { useT } from '../i18n'
import './CommandDock.css'

interface CommandDockProps {
  query: string
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onQuickNote: () => void
  onToggleGraph: () => void
  onToggleTags: () => void
  onToggleVault: () => void
  graphActive: boolean
  tagsActive: boolean
  vaultActive: boolean
  onToggleDraw: () => void
  drawActive: boolean
  onFrame: () => void
}

export const CommandDock = forwardRef<HTMLInputElement, CommandDockProps>(function CommandDock(
  {
    query,
    onQueryChange,
    onSubmit,
    onQuickNote,
    onToggleGraph,
    onToggleTags,
    onToggleVault,
    graphActive,
    tagsActive,
    vaultActive,
    onToggleDraw,
    drawActive,
    onFrame,
  },
  ref,
) {
  const tr = useT()
  return (
    <div className="command-dock glass-panel-strong">
      <div className="command-dock__search">
        <svg className="command-dock__search-icon" viewBox="0 0 20 20" width="16" height="16">
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <line x1="14" y1="14" x2="18" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={ref}
          className="command-dock__input"
          placeholder={tr('Шукайте або введіть назву нової нотатки…')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit()
          }}
        />
        <kbd className="command-dock__kbd">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
      </div>

      <div className="command-dock__divider" />

      <div className="command-dock__actions">
        <button className="command-dock__action" onClick={onQuickNote}>
          <ActionIcon kind="note" />
          <span>{tr('Нотатка')}</span>
        </button>
        <button
          className={`command-dock__action${graphActive ? ' is-active' : ''}`}
          onClick={onToggleGraph}
        >
          <ActionIcon kind="graph" />
          <span>{tr('Граф')}</span>
        </button>
        <button
          className={`command-dock__action${tagsActive ? ' is-active' : ''}`}
          onClick={onToggleTags}
        >
          <ActionIcon kind="tag" />
          <span>{tr('Теги')}</span>
        </button>
        <button
          className={`command-dock__action${vaultActive ? ' is-active' : ''}`}
          onClick={onToggleVault}
        >
          <ActionIcon kind="vault" />
          <span>{tr('Сховище')}</span>
        </button>
        <button
          className={`command-dock__action${drawActive ? ' is-active' : ''}`}
          onClick={onToggleDraw}
          aria-pressed={drawActive}
          title={tr('Малювання від руки')}
        >
          <ActionIcon kind="draw" />
          <span>{tr('Малювати')}</span>
        </button>
        <button className="command-dock__action" onClick={onFrame} title={tr('Рамка-група (обгорне виділені нотатки)')}>
          <ActionIcon kind="frame" />
          <span>{tr('Рамка')}</span>
        </button>
      </div>
    </div>
  )
})

function ActionIcon({ kind }: { kind: 'note' | 'graph' | 'tag' | 'vault' | 'draw' | 'frame' }) {
  const common = { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none' } as const
  switch (kind) {
    case 'note':
      return (
        <svg {...common}>
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    case 'graph':
      return (
        <svg {...common}>
          <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="15" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.6 7.2 8.6 13.4M13.4 7.2 11.4 13.4M7 6h6" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )
    case 'tag':
      return (
        <svg {...common}>
          <path
            d="M4 10.2 4 4h6.2L17 10.8 10.8 17 4 10.2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" />
        </svg>
      )
    case 'draw':
      return (
        <svg {...common}>
          <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M11.5 5.5l3 3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'frame':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="13" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2" />
          <path d="M6 7.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'vault':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.5 8h13" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
  }
}
