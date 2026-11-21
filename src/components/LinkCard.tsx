import { openExternal, serviceById, splitLinks, type NoteLink } from '../features/links'
import { useT } from '../i18n'

/** Body of a link note: service badge, domain, preview (YouTube) and «Open». */
export function LinkCard({ link }: { link: NoteLink }) {
  const tr = useT()
  const svc = serviceById(link.kind)
  let domain = link.url
  try {
    domain = new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    /* keep the raw url */
  }
  const light = ['x', 'medium', 'wikipedia'].includes(svc.id)
  return (
    <div className="link-card" style={{ '--svc': svc.color } as React.CSSProperties}>
      <div className="link-card__service">
        <span className={`link-card__badge${light ? ' is-light' : ''}`} aria-hidden>
          {svc.glyph}
        </span>
        <span>{svc.id === 'web' ? tr('Посилання') : svc.name}</span>
        <span className="link-card__domain">{domain}</span>
      </div>
      {link.thumb && (
        <div className="link-card__thumb" data-no-drag onClick={() => void openExternal(link.url)}>
          <img src={link.thumb} alt="" draggable={false} onError={(e) => (e.currentTarget.style.display = 'none')} />
          {svc.id === 'youtube' && <span className="link-card__play">▶</span>}
        </div>
      )}
      <button
        className="link-card__open"
        data-no-drag
        title={link.url}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void openExternal(link.url)
        }}
      >
        {tr('Відкрити')} ↗
      </button>
    </div>
  )
}

/** Note text with clickable http(s) links. */
export function Linkified({ text }: { text: string }) {
  const parts = splitLinks(text)
  if (parts.length === 1 && !parts[0].url) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        p.url ? (
          <a
            key={i}
            className="note-link"
            href={p.url}
            data-no-drag
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void openExternal(p.url!)
            }}
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
