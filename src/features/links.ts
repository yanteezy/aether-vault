/**
 * Link cards: a pasted URL becomes a note that knows which service it points to
 * (icon, colour, a readable title, a YouTube thumbnail) and opens in the browser.
 * Everything is worked out from the URL itself — nothing is fetched.
 */
export interface NoteLink {
  url: string
  /** Service id from LINK_SERVICES, or 'web'. */
  kind: string
  /** Optional preview picture (YouTube). */
  thumb?: string
}

interface Service {
  id: string
  name: string
  color: string
  /** Short glyph drawn on the badge. */
  glyph: string
  hosts: RegExp
  title?: (u: URL) => string | undefined
}

const seg = (u: URL) => u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
const pretty = (s: string) =>
  s
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function youtubeId(u: URL): string | undefined {
  if (/(^|\.)youtu\.be$/.test(u.hostname)) return seg(u)[0]
  if (u.searchParams.get('v')) return u.searchParams.get('v') ?? undefined
  const p = seg(u)
  if (p[0] === 'shorts' || p[0] === 'embed' || p[0] === 'live') return p[1]
  return undefined
}

export const LINK_SERVICES: Service[] = [
  { id: 'youtube', name: 'YouTube', color: '#ff0033', glyph: '▶', hosts: /(^|\.)(youtube\.com|youtu\.be)$/, title: (u) => (youtubeId(u) ? 'YouTube video' : undefined) },
  { id: 'github', name: 'GitHub', color: '#8b5cf6', glyph: '⌥', hosts: /(^|\.)github\.com$/, title: (u) => { const p = seg(u); return p.length >= 2 ? `${p[0]}/${p[1]}${p[2] === 'issues' || p[2] === 'pull' ? ` #${p[3] ?? ''}` : ''}` : p[0] } },
  { id: 'figma', name: 'Figma', color: '#a259ff', glyph: '◆', hosts: /(^|\.)figma\.com$/, title: (u) => { const p = seg(u); return p[2] ? pretty(p[2]) : undefined } },
  { id: 'gdocs', name: 'Google Docs', color: '#4285f4', glyph: '≡', hosts: /^docs\.google\.com$/, title: (u) => { const t = seg(u)[0]; return t === 'spreadsheets' ? 'Google Sheets' : t === 'presentation' ? 'Google Slides' : t === 'forms' ? 'Google Forms' : 'Google Doc' } },
  { id: 'gdrive', name: 'Google Drive', color: '#1fa463', glyph: '▲', hosts: /^drive\.google\.com$/ },
  { id: 'notion', name: 'Notion', color: '#9b9a97', glyph: 'N', hosts: /(^|\.)(notion\.so|notion\.site)$/, title: (u) => { const last = seg(u).pop(); return last ? pretty(last.replace(/-?[0-9a-f]{32}$/i, '')) || undefined : undefined } },
  { id: 'spotify', name: 'Spotify', color: '#1db954', glyph: '♫', hosts: /(^|\.)spotify\.com$/, title: (u) => { const t = seg(u)[0]; return t ? `Spotify ${t}` : undefined } },
  { id: 'soundcloud', name: 'SoundCloud', color: '#ff5500', glyph: '☁', hosts: /(^|\.)soundcloud\.com$/, title: (u) => seg(u).map(pretty).join(' — ') || undefined },
  { id: 'vimeo', name: 'Vimeo', color: '#1ab7ea', glyph: '▶', hosts: /(^|\.)vimeo\.com$/ },
  { id: 'instagram', name: 'Instagram', color: '#e1306c', glyph: '◎', hosts: /(^|\.)instagram\.com$/, title: (u) => { const p = seg(u); return p[0] && !['p', 'reel'].includes(p[0]) ? `@${p[0]}` : p[0] === 'reel' ? 'Instagram reel' : 'Instagram post' } },
  { id: 'x', name: 'X', color: '#e7e9ea', glyph: '𝕏', hosts: /(^|\.)(x\.com|twitter\.com)$/, title: (u) => { const p = seg(u); return p[0] ? `@${p[0]}${p[1] === 'status' ? ' · post' : ''}` : undefined } },
  { id: 'telegram', name: 'Telegram', color: '#2aabee', glyph: '✈', hosts: /^(t\.me|telegram\.me)$/, title: (u) => (seg(u)[0] ? `@${seg(u)[0]}` : undefined) },
  { id: 'tiktok', name: 'TikTok', color: '#25f4ee', glyph: '♪', hosts: /(^|\.)tiktok\.com$/, title: (u) => seg(u).find((p) => p.startsWith('@')) },
  { id: 'reddit', name: 'Reddit', color: '#ff4500', glyph: '●', hosts: /(^|\.)reddit\.com$/, title: (u) => { const p = seg(u); return p[0] === 'r' ? (p[4] ? pretty(p[4]) : `r/${p[1]}`) : undefined } },
  { id: 'wikipedia', name: 'Wikipedia', color: '#c8ccd1', glyph: 'W', hosts: /(^|\.)wikipedia\.org$/, title: (u) => (seg(u)[1] ? pretty(seg(u)[1]) : undefined) },
  { id: 'linkedin', name: 'LinkedIn', color: '#0a66c2', glyph: 'in', hosts: /(^|\.)linkedin\.com$/, title: (u) => (seg(u)[1] ? pretty(seg(u)[1]) : undefined) },
  { id: 'medium', name: 'Medium', color: '#e6e6e6', glyph: 'M', hosts: /(^|\.)medium\.com$/, title: (u) => { const last = seg(u).pop(); return last ? cap(pretty(last.replace(/-[0-9a-f]{8,}$/i, ''))) : undefined } },
  { id: 'dribbble', name: 'Dribbble', color: '#ea4c89', glyph: '◍', hosts: /(^|\.)dribbble\.com$/ },
  { id: 'behance', name: 'Behance', color: '#1769ff', glyph: 'Bē', hosts: /(^|\.)behance\.net$/ },
  { id: 'pinterest', name: 'Pinterest', color: '#e60023', glyph: 'P', hosts: /(^|\.)pinterest\.[a-z.]+$/ },
  { id: 'stackoverflow', name: 'Stack Overflow', color: '#f48024', glyph: '≣', hosts: /(^|\.)stackoverflow\.com$/, title: (u) => { const p = seg(u); return p[0] === 'questions' && p[2] ? cap(pretty(p[2])) : undefined } },
  { id: 'maps', name: 'Google Maps', color: '#34a853', glyph: '⌖', hosts: /^(maps\.google\.[a-z.]+|www\.google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)$/ },
]

const WEB: Service = { id: 'web', name: 'Link', color: '#8e8e93', glyph: '↗', hosts: /$^/ }

export const serviceById = (id: string) => LINK_SERVICES.find((s) => s.id === id) ?? WEB

/** A single http(s) URL (the whole text, ignoring surrounding spaces), or undefined. */
export function parseUrl(text: string): URL | undefined {
  const t = text.trim()
  if (!t || /\s/.test(t)) return undefined
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : /^www\./i.test(t) ? `https://${t}` : t)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : undefined
  } catch {
    return undefined
  }
}

/** What a pasted URL turns into: link info + a readable title. */
export function describeLink(u: URL): { link: NoteLink; title: string } {
  const host = u.hostname.replace(/^www\./, '')
  const svc = LINK_SERVICES.find((s) => s.hosts.test(u.hostname) || s.hosts.test(host))
  // google.com/maps/... is Maps; other google.com pages are plain links
  const isMaps = svc?.id === 'maps' ? /maps/.test(u.hostname + u.pathname) : true
  const s = svc && isMaps ? svc : WEB
  let thumb: string | undefined
  if (s.id === 'youtube') {
    const id = youtubeId(u)
    if (id) thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  }
  const title = s.title?.(u) || (s === WEB ? host : s.name) || host
  return { link: { url: u.href, kind: s.id, thumb }, title }
}

/** Splits text into plain parts and URLs (for clickable links inside note text). */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = []
  const re = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}»])/gi
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], url: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Open in the system browser (Tauri opener plugin; plain window.open in a browser). */
export async function openExternal(url: string) {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}
