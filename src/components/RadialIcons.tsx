const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export type RadialIconName = 'new' | 'search' | 'fit' | 'zoom' | 'list' | 'canvas' | 'theme' | 'settings' | 'delete' | 'tab-next' | 'tab-prev'

export function RadialIcon({ name }: { name: RadialIconName }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
      {name === 'new' && (
        <>
          <rect x="3.5" y="3.5" width="13" height="13" rx="3" {...P} />
          <path d="M10 7v6M7 10h6" {...P} />
        </>
      )}
      {name === 'search' && (
        <>
          <circle cx="9" cy="9" r="5.5" {...P} />
          <path d="M13.2 13.2 17 17" {...P} />
        </>
      )}
      {name === 'fit' && <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" {...P} />}
      {name === 'zoom' && (
        <>
          <circle cx="9" cy="9" r="5.5" {...P} />
          <path d="M13.2 13.2 17 17M9 6.5v5" {...P} />
        </>
      )}
      {name === 'list' && <path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01" {...P} />}
      {name === 'canvas' && (
        <>
          <rect x="2.5" y="4" width="6" height="5" rx="1.5" {...P} />
          <rect x="11.5" y="11" width="6" height="5" rx="1.5" {...P} />
          <path d="M8.5 6.5c4 0 3 7 3 7" {...P} />
        </>
      )}
      {name === 'theme' && (
        <>
          <circle cx="10" cy="10" r="6.5" {...P} />
          <path d="M10 3.5v13a6.5 6.5 0 0 0 0-13Z" fill="currentColor" />
        </>
      )}
      {name === 'settings' && (
        <>
          <circle cx="10" cy="10" r="2.5" {...P} />
          <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" {...P} />
        </>
      )}
      {name === 'tab-next' && <path d="M3 10h12M11 5.5 15.5 10 11 14.5M17.5 4v12" {...P} />}
      {name === 'tab-prev' && <path d="M17 10H5M9 5.5 4.5 10 9 14.5M2.5 4v12" {...P} />}
      {name === 'delete' && <path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6" {...P} />}
    </svg>
  )
}
