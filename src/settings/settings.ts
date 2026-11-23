import type { Lang } from '../i18n'
import { fontStack, type NoteFont } from './fonts'
export type GridStyle = 'dots' | 'lines' | 'none'
export type AnimationSpeed = 'off' | 'fast' | 'normal' | 'relaxed'
export type ThemeId = 'glass' | 'light' | 'detective' | 'blueprint' | 'mono'

export const THEMES: { id: ThemeId; name: string; description: string }[] = [
  { id: 'glass', name: 'Скло', description: 'Матове скло, темне полотно' },
  { id: 'light', name: 'Світла', description: 'Світле скло в стилі macOS' },
  { id: 'detective', name: 'Дошка детектива', description: 'Корок, папір, піни та червоні нитки' },
  { id: 'blueprint', name: 'Креслення', description: 'Інженерна синька, біла сітка' },
  { id: 'mono', name: 'Монохром', description: 'Строгий чорно-білий, без скла' },
]

/** Canvas background for the plain themes (Glass and Light): calm tones and quiet patterns. */
export type CanvasBg = 'default' | 'graphite' | 'fog' | 'sage' | 'sand' | 'diagonal' | 'plus' | 'waves' | 'linen'
export const CANVAS_BGS: { id: CanvasBg; name: string; pattern?: boolean }[] = [
  { id: 'default', name: 'Стандарт' },
  { id: 'graphite', name: 'Графіт' },
  { id: 'fog', name: 'Туман' },
  { id: 'sage', name: 'Шавлія' },
  { id: 'sand', name: 'Пісок' },
  { id: 'diagonal', name: 'Діагоналі', pattern: true },
  { id: 'plus', name: 'Плюсики', pattern: true },
  { id: 'waves', name: 'Хвилі', pattern: true },
  { id: 'linen', name: 'Льон', pattern: true },
]
/** Only the dark (Glass) and light themes take a custom background; the others have their own look. */
export const themeHasCanvasBg = (t: ThemeId) => t === 'glass' || t === 'light'

export interface AppSettings {
  /** @deprecated kept only to migrate the first vault's name */
  vaultName: string
  theme: ThemeId
  accent: string
  glassBlur: number // px
  cardOpacity: number // 0.4 – 1
  cardRadius: number // px
  grid: GridStyle
  animation: AnimationSpeed
  cardFontSize: number // px, body text
  connectionWidth: number // px
  showZoom: boolean
  /** Text size follows the note's size (notes without their own size). */
  autoTextSize: boolean
  /** Much smaller card corners (overrides cardRadius). */
  compactCorners: boolean
  /** Hold-to-open key of the radial menu: 'Alt' | 'Shift' or a KeyboardEvent.code ('Backquote', 'KeyQ'…). */
  radialKey: string
  /** Interface language. */
  language: Lang
  /** Wheel / pinch zoom towards the cursor; off = towards the centre of the visible board. */
  zoomToCursor: boolean
  /** Font of the note cards ('auto' = the theme's own font). */
  noteFont: NoteFont
  /** Canvas background (Glass and Light themes only). */
  canvasBg: CanvasBg
}

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: 'Blue', value: '#0a84ff' },
  { name: 'Purple', value: '#bf5af2' },
  { name: 'Pink', value: '#ff375f' },
  { name: 'Red', value: '#ff453a' },
  { name: 'Orange', value: '#ff9f0a' },
  { name: 'Yellow', value: '#ffd60a' },
  { name: 'Green', value: '#32d74b' },
  { name: 'Graphite', value: '#98989d' },
]

export const DEFAULT_SETTINGS: AppSettings = {
  vaultName: 'Aether',
  theme: 'glass',
  accent: '#0a84ff',
  glassBlur: 24,
  cardOpacity: 0.75,
  cardRadius: 14,
  grid: 'dots',
  animation: 'normal',
  cardFontSize: 15,
  connectionWidth: 2,
  showZoom: true,
  autoTextSize: true,
  compactCorners: true,
  radialKey: 'Alt',
  language: 'en',
  zoomToCursor: false,
  noteFont: 'auto',
  canvasBg: 'default',
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Keys that can't hold the radial menu (they already do something else). */
const RESERVED = new Set(['Escape', 'Space', 'Enter', 'NumpadEnter', 'Backspace', 'Delete', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'OSLeft', 'OSRight'])

/** Setting value for a pressed key, or null if that key can't be used. */
export function radialKeyFromEvent(e: KeyboardEvent): string | null {
  if (e.key === 'Alt' || e.key === 'AltGraph') return 'Alt'
  if (e.key === 'Shift') return 'Shift'
  if (!e.code || RESERVED.has(e.code)) return null
  return e.code
}

/** Does this key event belong to the configured radial key? */
export function isRadialKey(e: KeyboardEvent, setting: string): boolean {
  if (setting === 'Alt') return e.key === 'Alt' || e.key === 'AltGraph' || e.code === 'AltLeft' || e.code === 'AltRight'
  if (setting === 'Shift') return e.key === 'Shift'
  return e.code === setting
}

/** Human label for a key setting (layout independent). */
export function keyLabel(setting: string): string {
  if (setting === 'Alt') return IS_MAC ? '⌥ Option' : 'Alt'
  if (setting === 'Shift') return IS_MAC ? '⇧ Shift' : 'Shift'
  const named: Record<string, string> = {
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '§',
    CapsLock: 'Caps Lock', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', Insert: 'Insert', ContextMenu: 'Menu',
  }
  if (named[setting]) return named[setting]
  if (/^Key[A-Z]$/.test(setting)) return setting.slice(3)
  if (/^Digit\d$/.test(setting)) return setting.slice(5)
  if (/^Numpad/.test(setting)) return 'Num ' + setting.slice(6)
  return setting
}

/** Short glyph for the radial hub. */
export function keyGlyph(setting: string): string {
  if (setting === 'Alt') return IS_MAC ? '⌥' : 'Alt'
  if (setting === 'Shift') return '⇧'
  return keyLabel(setting)
}

export const COMPACT_RADIUS = 6 // Gemini (Дизайн)

// [fast, slow, easing] — values from Gemini (Дизайн)
const SPEED: Record<AnimationSpeed, [number, number, string]> = {
  off: [0, 0, 'linear'],
  fast: [160, 240, 'cubic-bezier(0.2, 0.9, 0.2, 1)'],
  normal: [260, 420, 'cubic-bezier(0.34, 1.56, 0.64, 1)'],
  relaxed: [380, 560, 'cubic-bezier(0.16, 1, 0.3, 1)'],
}

export const GRID: Record<GridStyle, { size: number; color: string }> = {
  dots: { size: 24, color: 'rgba(255, 255, 255, 0.14)' },
  lines: { size: 32, color: 'rgba(255, 255, 255, 0.05)' },
  none: { size: 24, color: 'transparent' },
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Pushes settings into CSS custom properties on :root. */
export function applySettings(s: AppSettings) {
  const root = document.documentElement.style
  const [r, g, b] = hexToRgb(s.accent)
  const [fast, slow, ease] = SPEED[s.animation]
  root.setProperty('--accent', s.accent)
  root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`)
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.18)`)
  // filled buttons need readable text whatever accent was picked (WCAG 1.4.3: 4.5:1)
  const fill = accentFill(r, g, b)
  root.setProperty('--accent-fill', fill.bg)
  root.setProperty('--on-accent', fill.fg)
  root.setProperty('--glass-blur', `${s.glassBlur}px`)
  root.setProperty('--glass-bg', `rgba(30, 31, 40, ${s.cardOpacity})`)
  root.setProperty('--card-opacity', `${s.cardOpacity}`)
  root.setProperty('--connection-width', `${s.connectionWidth}px`)
  root.setProperty('--dot-color', GRID[s.grid].color)
  root.setProperty('--spring', ease)
  root.setProperty('--card-radius', `${s.compactCorners ? COMPACT_RADIUS : s.cardRadius}px`)
  root.setProperty('--auto-text', s.autoTextSize ? '1' : '0')
  document.body.dataset.autoText = s.autoTextSize ? '1' : '0'
  document.body.dataset.compact = s.compactCorners ? '1' : '0'
  root.setProperty('--card-font-size', `${s.cardFontSize}px`)
  root.setProperty('--card-font-num', `${s.cardFontSize}`)
  root.setProperty('--spring-fast', `${fast}ms var(--spring)`)
  root.setProperty('--spring-slow', `${slow}ms var(--spring)`)
  root.setProperty('--speed-fast', `${fast}ms`)
  root.setProperty('--speed-slow', `${slow}ms`)
  document.body.dataset.theme = s.theme
  document.body.dataset.canvasBg = themeHasCanvasBg(s.theme) && CANVAS_BGS.some((b) => b.id === s.canvasBg) ? s.canvasBg : 'default'
  document.body.dataset.noteFont = s.noteFont || 'auto'
  root.setProperty('--note-font-global', fontStack(s.noteFont) || 'inherit')
}

/** Relative luminance (WCAG). */
const lum = (r: number, g: number, b: number) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
/**
 * The fill for accent-coloured buttons: the accent darkened just enough for white text to reach 4.5:1;
 * light accents (yellow, mint) that would turn muddy keep their colour and get near-black text instead.
 */
export function accentFill(r: number, g: number, b: number): { bg: string; fg: string } {
  for (let k = 0; k <= 0.45; k += 0.02) {
    const c = [r, g, b].map((v) => Math.round(v * (1 - k)))
    if (ratio(1, lum(c[0], c[1], c[2])) >= 4.6) return { bg: `rgb(${c.join(', ')})`, fg: '#ffffff' }
  }
  return { bg: `rgb(${r}, ${g}, ${b})`, fg: ratio(lum(r, g, b), lum(17, 17, 20)) >= 4.6 ? '#111114' : '#000000' }
}
