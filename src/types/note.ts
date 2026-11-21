export type NoteBlockKind = 'text' | 'checklist' | 'code'

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** Per-note text size: 'auto' (follows the card's size) or body text in px. */
export type NoteFontSize = 'auto' | number

export const FONT_MIN = 10
export const FONT_MAX = 32
export const clampFont = (px: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px)))

/** Older builds stored S/M/L/XL presets — map them to px. */
const LEGACY_FONT_PX: Record<string, number> = { s: 13, m: 15, l: 17, xl: 20 }
export function resolveFontSize(v: unknown): NoteFontSize | undefined {
  if (v === 'auto') return 'auto'
  if (typeof v === 'number' && Number.isFinite(v)) return clampFont(v)
  if (typeof v === 'string' && v in LEGACY_FONT_PX) return LEGACY_FONT_PX[v]
  return undefined
}

/** CSS value for --note-manual: px relative to the global card text size. */
export function manualScale(v: NoteFontSize | undefined, width: number, height: number): string | number | undefined {
  if (v === undefined) return undefined
  if (v === 'auto') return autoScale(width, height)
  return `calc(${v} / var(--card-font-num, 15))`
}

/** Layout preset of a note. */
export type NoteStyle = 'plain' | 'headline' | 'caps' | 'banner' | 'quote' | 'bullets'
export type TitleAlign = 'left' | 'center' | 'right'

export type NoteColor = 'default' | 'accent' | 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'gray'


/** Reference card for auto text size: the "M" preset (260 × 160) = 1×. */
const AUTO_BASE_AREA = 260 * 160
export const AUTO_SCALE_MIN = 0.9
export const AUTO_SCALE_MAX = 1.3
const AUTO_EXP = 0.25 // values from Gemini (Дизайн)
/** Text scale that follows only the card's size (area), soft curve, clamped. */
export function autoScale(width: number, height: number): number {
  const k = Math.pow((width * height) / AUTO_BASE_AREA, AUTO_EXP)
  return Math.round(Math.min(AUTO_SCALE_MAX, Math.max(AUTO_SCALE_MIN, k)) * 100) / 100
}

export interface Vault {
  id: string
  name: string
  createdAt: number
  /** Own theme of this workspace (otherwise the one from Settings). */
  theme?: import('../settings/settings').ThemeId
  /** Own canvas background — used together with the workspace's own theme. */
  canvasBg?: import('../settings/settings').CanvasBg
  /** Starts with the feature guide instead of an empty canvas. */
  seed?: 'guide'
}

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
}

export interface NoteCardData {
  id: string
  title: string
  tags: string[]
  x: number
  y: number
  width: number
  height: number
  body?: string
  checklist?: ChecklistItem[]
  code?: { language: string; content: string }
  color?: NoteColor
  /** Locked notes can't be dragged or resized. */
  locked?: boolean
  style?: NoteStyle
  titleAlign?: TitleAlign
  /** Per-note text size (independent from the global setting). */
  fontSize?: NoteFontSize
  /** Per-note font; undefined = the font from Settings. */
  font?: import('../settings/fonts').NoteFont
  /** Photo in the background of the note (stored in IndexedDB). */
  image?: import('../features/images').NoteImage
  /** The note is a link card (YouTube, GitHub, Figma…). */
  link?: import('../features/links').NoteLink
  updatedAt?: number
}

export interface Connection {
  id: string
  from: string
  to: string
  /** Side of the source note the curve leaves from (default: right). */
  fromSide?: Side
  /** Side of the target note the curve enters (default: left). */
  toSide?: Side
}

// ---------- freehand ink ----------

export type InkTool = 'pen' | 'marker' | 'eraser'
export type InkPreset = 'chalk' | 'cyan' | 'lavender' | 'amber' | 'mint'
/** A preset (follows the theme for 'chalk') or any colour picked in the palette ('#rrggbb'). */
export type InkColor = InkPreset | `#${string}`

export const INK_COLORS: { id: InkColor; label: string; hex: string }[] = [
  { id: 'chalk', label: 'Крейда', hex: '#ffffff' },
  { id: 'cyan', label: 'Неоновий ціан', hex: '#22d3ee' },
  { id: 'lavender', label: 'Лавандовий', hex: '#c084fc' },
  { id: 'amber', label: 'Бурштиновий', hex: '#fbbf24' },
  { id: 'mint', label: 'М’ятний', hex: '#34d399' },
]

/** The four swatches show the last colours used; these fill it on first run. */
export const INK_RECENT_DEFAULT: InkColor[] = ['chalk', 'cyan', 'lavender', 'amber']
/** Palette: soft neutrals first, then calm and vivid hues that read on dark and light boards. */
export const INK_PALETTE: `#${string}`[] = [
  '#ffffff', '#d1d5db', '#9ca3af', '#4b5563', '#1f2937', '#000000',
  '#fca5a5', '#f87171', '#fb923c', '#fbbf24', '#fde047', '#a3e635',
  '#34d399', '#2dd4bf', '#22d3ee', '#60a5fa', '#818cf8', '#c084fc',
  '#f472b6', '#e879f9', '#a78bfa', '#93c5fd', '#fcd34d', '#d6b38a',
]
/** Put a just-used colour first in the recent list (4 entries, no repeats). */
export const pushRecentInk = (list: InkColor[], c: InkColor): InkColor[] =>
  [c, ...list.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 4)

export const INK_WIDTH: Record<'pen' | 'marker', number> = { pen: 2.5, marker: 14 }
export const MARKER_ALPHA = 0.35

export interface InkStroke {
  id: string
  tool: 'pen' | 'marker'
  color: InkColor
  /** Flat world coordinates relative to (x, y): [x0, y0, x1, y1, …]. */
  points: number[]
  /** Offset — moving a stroke (e.g. with its frame) only changes this. */
  x: number
  y: number
  /** Drawn on top of this note: x / y are relative to the note, it travels with it as part of its background. */
  note?: string
}

// ---------- smart frames ----------

export type FrameColor = 'default' | 'cyan' | 'lavender' | 'amber' | 'mint' | 'pink'

export const FRAME_COLORS: { id: FrameColor; label: string; rgb: string }[] = [
  { id: 'default', label: 'Скло', rgb: '255, 255, 255' },
  { id: 'cyan', label: 'Ціан', rgb: '34, 211, 238' },
  { id: 'lavender', label: 'Лавандовий', rgb: '192, 132, 252' },
  { id: 'amber', label: 'Бурштиновий', rgb: '251, 191, 36' },
  { id: 'mint', label: 'М’ятний', rgb: '52, 211, 153' },
  { id: 'pink', label: 'Рожевий', rgb: '255, 55, 95' },
]

export interface Frame {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  color: FrameColor
  /** Locked frames can't be dragged or resized. */
  locked?: boolean
}

// ---------- tag buttons (chips placed on the canvas) ----------

export type ChipColor = 'accent' | 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'gray'

export const CHIP_COLORS: Record<ChipColor, string> = {
  accent: 'var(--accent)',
  red: '#ff453a',
  amber: '#ffb340',
  green: '#32d74b',
  blue: '#40a9ff',
  purple: '#bf5af2',
  gray: '#98989d',
}

/** A tag button on the canvas: click filters notes by its tag, drop it on a note to tag it. */
export type ChipSize = 's' | 'm' | 'l'

export const CHIP_SCALE_MIN = 0.6
export const CHIP_SCALE_MAX = 3
/** Current free size of a button (old S / L presets map onto it). */
export const chipScale = (c: { size?: ChipSize; scale?: number }) =>
  c.scale ?? (c.size === 's' ? 0.8 : c.size === 'l' ? 1.25 : 1)
export const clampChipScale = (v: number) =>
  Math.round(Math.min(CHIP_SCALE_MAX, Math.max(CHIP_SCALE_MIN, v)) * 100) / 100

/** What a triggered button does to the notes / frames wired to it. */
export type TagEffect = 'important' | 'idea' | 'todo' | 'question' | 'done' | 'private' | 'highlight' | 'fade'

export interface TagChip {
  id: string
  tag: string
  x: number
  y: number
  color: ChipColor
  /** Legacy preset; superseded by `scale` once the button is resized by hand. */
  size?: ChipSize
  /** Free size set by dragging the corner grip or the menu slider (1 = normal). */
  scale?: number
  /** Effect of a custom button (ready-made buttons have a fixed one). */
  effect?: TagEffect
  /** Switched on: wired objects show the effect. */
  on?: boolean
  /** Wired note / frame ids. */
  targets?: string[]
}
