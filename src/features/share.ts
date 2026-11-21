/**
 * Share a board as a link — no server: the whole board travels inside the link.
 *
 *   https://yanteezy.github.io/aether-vault/open/#a1.<flags>.<data>
 *
 * Everything after "#" is the fragment: browsers never send it to any server (GitHub Pages included).
 * <data> is the board as JSON, deflate-compressed (flag "z") and base64url-encoded.
 * With a password (flag "e") the compressed bytes are encrypted with AES-256-GCM; the key is derived from the
 * password with PBKDF2-SHA-256 (250 000 rounds, random salt). Without the password the link is unreadable.
 * The same token also opens as aether://open#a1.… (the app's own link scheme).
 *
 * Photos are not put into links (they would make them huge) — the board's .aether file carries those.
 */
import type { CanvasBg, ThemeId } from '../settings/settings'
import type { Connection, Frame, InkStroke, NoteCardData, TagChip } from '../types/note'

export const SHARE_PAGE = 'https://yanteezy.github.io/aether-vault/open/'
const VERSION = 'a1'
const ROUNDS = 250_000
/** Longer links still work, but some messengers cut or refuse them. */
export const LONG_LINK = 8000

export interface SharedBoard {
  v: 1
  name: string
  notes: NoteCardData[]
  connections: Connection[]
  frames: Frame[]
  chips: TagChip[]
  strokes: InkStroke[]
  theme?: { theme: ThemeId; canvasBg?: CanvasBg }
}

// ---------- bytes ----------
const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await res.arrayBuffer())
}
const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

async function keyFrom(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ROUNDS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---------- make a link ----------
export async function makeShareLink(board: SharedBoard, password?: string): Promise<string> {
  let bytes: Uint8Array = enc.encode(JSON.stringify(board))
  let flags = ''
  if (canZip()) {
    bytes = await pipe(bytes, new CompressionStream('deflate-raw'))
    flags += 'z'
  }
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await keyFrom(password, salt)
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, bytes as BufferSource))
    bytes = new Uint8Array(16 + 12 + sealed.length)
    bytes.set(salt, 0)
    bytes.set(iv, 16)
    bytes.set(sealed, 28)
    flags += 'e'
  }
  return `${SHARE_PAGE}#${VERSION}.${flags || 'j'}.${toB64url(bytes)}`
}

// ---------- read a link ----------
export interface ShareToken {
  token: string
  encrypted: boolean
}
const TOKEN_RE = /(?:^|[#/?=])(a1\.[a-z]+\.[A-Za-z0-9_-]{8,})/

/** Recognise an Aether board link (the web page, aether://… or just the token). */
export function parseShareLink(text: string): ShareToken | null {
  const t = text.trim()
  if (!t || t.length > 2_000_000) return null
  // the link may come inside a message ("look: https://…")
  const looksLikeOurs = t.includes(SHARE_PAGE) || t.includes('aether://open') || /^a1\.[a-z]+\./.test(t) || t.includes('/aether-vault/open/#')
  if (!looksLikeOurs) return null
  const m = t.match(TOKEN_RE)
  if (!m) return null
  const flags = m[1].split('.')[1]
  return { token: m[1], encrypted: flags.includes('e') }
}

/** Errors: 'password' (missing or wrong), 'broken' (damaged / not a board), 'unsupported' (needs a newer webview). */
export async function openShareToken(token: string, password?: string): Promise<SharedBoard> {
  const [ver, flags, data] = token.split('.')
  if (ver !== VERSION || !flags || !data) throw new Error('broken')
  let bytes: Uint8Array
  try {
    bytes = fromB64url(data)
  } catch {
    throw new Error('broken')
  }
  if (flags.includes('e')) {
    if (!password) throw new Error('password')
    if (bytes.length < 29) throw new Error('broken')
    try {
      const key = await keyFrom(password, bytes.subarray(0, 16))
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(16, 28) as BufferSource }, key, bytes.subarray(28) as BufferSource))
    } catch {
      throw new Error('password') // AES-GCM fails on a wrong key
    }
  }
  if (flags.includes('z')) {
    if (!canZip()) throw new Error('unsupported')
    try {
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
    } catch {
      throw new Error('broken')
    }
  }
  let board: SharedBoard
  try {
    board = JSON.parse(dec.decode(bytes))
  } catch {
    throw new Error('broken')
  }
  if (!board || board.v !== 1 || !Array.isArray(board.notes)) throw new Error('broken')
  return {
    v: 1,
    name: typeof board.name === 'string' ? board.name.slice(0, 80) : '',
    notes: board.notes,
    connections: Array.isArray(board.connections) ? board.connections : [],
    frames: Array.isArray(board.frames) ? board.frames : [],
    chips: Array.isArray(board.chips) ? board.chips : [],
    strokes: Array.isArray(board.strokes) ? board.strokes : [],
    ...(board.theme?.theme ? { theme: board.theme } : {}),
  }
}

/** A readable, strong password: four groups of letters and digits, e.g. "k7pa-m2qe-x9tr-b4wn". */
export function generatePassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint8Array(16))
  let s = ''
  for (let i = 0; i < 16; i++) s += abc[r[i] % abc.length] + (i % 4 === 3 && i < 15 ? '-' : '')
  return s
}

/** Copy text to the clipboard (with a fallback for webviews without the async API). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* fall back below */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}
