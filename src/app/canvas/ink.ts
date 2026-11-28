/**
 * Drawing colour: the current one and the last four used (newest first), kept between runs like other UI state.
 * Strokes store their colour in the canvas file (`Stroke.color`), so a drawing keeps its colours anywhere.
 */
const CURRENT = 'ink-color'
const RECENT = 'ink-recent'
export const DEFAULT_INK = ['#f5f5f7', '#ff6b6b', '#4dabf7', '#ffd43b']

const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

export function recentInk(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? 'null')
    if (Array.isArray(list) && list.length === 4 && list.every(isHex)) return list
  } catch { /* default below */ }
  return [...DEFAULT_INK]
}
export function inkColor(): string {
  const c = localStorage.getItem(CURRENT)
  return isHex(c) ? c : recentInk()[0]
}
/** Picks a colour. A new one (from the picker) goes first and pushes the oldest out; a recent one just stays where it is. */
export function useInk(color: string) {
  const c = color.toLowerCase()
  if (!isHex(c)) return
  const recent = recentInk()
  if (!recent.includes(c)) localStorage.setItem(RECENT, JSON.stringify([c, ...recent].slice(0, 4)))
  localStorage.setItem(CURRENT, c)
}
