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
export type InkColor = 'chalk' | 'cyan' | 'lavender' | 'amber' | 'mint'

export const INK_COLORS: { id: InkColor; label: string; hex: string }[] = [
  { id: 'chalk', label: 'Крейда', hex: '#ffffff' },
  { id: 'cyan', label: 'Неоновий ціан', hex: '#22d3ee' },
  { id: 'lavender', label: 'Лавандовий', hex: '#c084fc' },
  { id: 'amber', label: 'Бурштиновий', hex: '#fbbf24' },
  { id: 'mint', label: 'М’ятний', hex: '#34d399' },
]

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

/** What a triggered button does to the notes / frames wired to it. */
export type TagEffect = 'important' | 'idea' | 'todo' | 'question' | 'done' | 'private' | 'highlight' | 'fade'

export interface TagChip {
  id: string
  tag: string
  x: number
  y: number
  color: ChipColor
  size?: ChipSize
  /** Effect of a custom button (ready-made buttons have a fixed one). */
  effect?: TagEffect
  /** Switched on: wired objects show the effect. */
  on?: boolean
  /** Wired note / frame ids. */
  targets?: string[]
}
