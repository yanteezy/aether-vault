/**
 * Note fonts and text size, as in Aether 0.2.24: system font stacks (nothing downloaded), a global card text
 * size (10–32 px) with an «auto size» switch, and per-card overrides. App-wide, kept in localStorage.
 */

export type NoteFont = 'auto' | 'system' | 'serif' | 'rounded' | 'mono' | 'typewriter' | 'hand'
export type NoteFontSize = 'auto' | number

export const NOTE_FONTS: { id: NoteFont; label: string; stack: string }[] = [
  { id: 'auto', label: 'Як у темі', stack: '' },
  { id: 'system', label: 'Системний', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif" },
  { id: 'serif', label: 'Із засічками', stack: "'New York', 'Iowan Old Style', Charter, Georgia, 'Cambria', 'Times New Roman', serif" },
  { id: 'rounded', label: 'Округлий', stack: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Segoe UI Variable Display', 'Segoe UI', sans-serif" },
  { id: 'mono', label: 'Моноширинний', stack: "ui-monospace, 'SF Mono', Menlo, 'Cascadia Mono', Consolas, monospace" },
  { id: 'typewriter', label: 'Друкарська машинка', stack: "'American Typewriter', 'Courier New', Courier, monospace" },
  { id: 'hand', label: 'Рукописний', stack: "'Bradley Hand', Noteworthy, 'Segoe Print', 'Ink Free', 'Comic Sans MS', cursive" },
]
export const fontStack = (id: NoteFont | undefined) => NOTE_FONTS.find((f) => f.id === id)?.stack ?? ''

export const FONT_MIN = 10
export const FONT_MAX = 32
export const clampFont = (px: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px)))

/** Text scale that follows only the card's area (260 × 160 = 1×), soft curve, 0.9–1.3 — Aether's formula. */
export function autoScale(width: number, height: number): number {
  const k = Math.pow((width * height) / (260 * 160), 0.25)
  return Math.round(Math.min(1.3, Math.max(0.9, k)) * 100) / 100
}

export interface Appearance { noteFont: NoteFont; cardFontSize: number; autoTextSize: boolean }
const KEY = 'aether-appearance'
const DEFAULTS: Appearance = { noteFont: 'auto', cardFontSize: 15, autoTextSize: true }

export function loadAppearance(): Appearance {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return { ...DEFAULTS } }
}

/** Card text px for a card: its own size, or «auto» (by area), or the global size. */
export function cardFontPx(a: Appearance, own: NoteFontSize | undefined, width: number, height: number) {
  const size = own ?? (a.autoTextSize ? 'auto' : undefined)
  if (typeof size === 'number') return clampFont(size)
  return size === 'auto' ? a.cardFontSize * autoScale(width, height) : a.cardFontSize
}

export function applyAppearance(a: Appearance) {
  const s = document.body.style
  s.setProperty('--note-font-global', fontStack(a.noteFont) || 'var(--font-text)')
  s.setProperty('--card-font-size', `${a.cardFontSize}px`)
  document.body.dataset.autoText = a.autoTextSize ? '1' : '0'
}

export function saveAppearance(patch: Partial<Appearance>) {
  const next = { ...loadAppearance(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  applyAppearance(next)
  window.dispatchEvent(new CustomEvent('aether:appearance', { detail: next }))
  return next
}

// ---- controls shared by Settings and the card menu (Aether's FontPicker / FontSizePicker) ----

/** «Aa» tiles, each in its own font; `withDefault` adds «as in Settings» (value undefined) for a single card. */
export function fontTiles(parent: HTMLElement, value: NoteFont | undefined, onChange: (v: NoteFont | undefined) => void, withDefault = false) {
  const box = parent.createDiv({ cls: 'font-tiles', attr: { role: 'radiogroup', 'aria-label': 'Шрифт' } })
  const items: { id: NoteFont | undefined; label: string; stack: string }[] = withDefault
    ? [{ id: undefined, label: 'Як у налаштуваннях', stack: '' }, ...NOTE_FONTS.filter((f) => f.id !== 'auto')]
    : NOTE_FONTS
  const render = (current: NoteFont | undefined) => {
    box.empty()
    for (const f of items) {
      const active = current === f.id || (!withDefault && f.id === 'auto' && !current)
      const b = box.createEl('button', { cls: `font-tile${active ? ' is-active' : ''}${f.stack ? '' : ' is-default'}`, attr: { role: 'radio', 'aria-checked': active, title: f.label } })
      if (f.stack) b.style.fontFamily = f.stack
      b.createSpan({ cls: 'font-tile__aa', text: f.stack ? 'Aa' : '•' })
      b.createSpan({ cls: 'font-tile__label', text: f.label })
      b.addEventListener('click', () => { render(f.id); onChange(f.id) })
    }
  }
  render(value)
  return box
}

/** [Авто] [−] [15] px [+] and a slider (10–32 px). `value` undefined or 'auto' shows `shownPx` greyed. */
export function fontSizeControl(parent: HTMLElement, value: NoteFontSize | undefined, shownPx: number, onChange: (v: NoteFontSize) => void, allowAuto = false) {
  const box = parent.createDiv('fs-control')
  let current = value
  const row = box.createDiv('fs-control__row')
  const auto = allowAuto ? row.createEl('button', { cls: 'fs-control__auto', text: 'Авто', attr: { title: 'Текст змінюється разом із розміром нотатки' } }) : null
  const stepper = row.createDiv('fs-control__stepper')
  const minus = stepper.createEl('button', { text: '−', attr: { 'aria-label': 'Менше' } })
  const label = stepper.createEl('label', 'fs-control__value')
  const input = label.createEl('input', { attr: { inputmode: 'numeric', 'aria-label': 'Розмір тексту, px' } })
  label.createSpan({ text: 'px' })
  const plus = stepper.createEl('button', { text: '+', attr: { 'aria-label': 'Більше' } })
  const slider = box.createEl('input', { type: 'range', cls: 'fs-control__slider', attr: { 'aria-label': 'Розмір тексту', min: FONT_MIN, max: FONT_MAX, step: 1 } })
  const px = () => (typeof current === 'number' ? current : Math.round(shownPx))
  const sync = () => {
    const p = px()
    input.value = String(p)
    slider.value = String(p)
    slider.style.setProperty('--fill', `${((p - FONT_MIN) / (FONT_MAX - FONT_MIN)) * 100}%`)
    box.toggleClass('is-auto', typeof current !== 'number')
    auto?.setAttr('aria-pressed', current === 'auto')
    auto?.toggleClass('is-active', current === 'auto')
    minus.disabled = p <= FONT_MIN
    plus.disabled = p >= FONT_MAX
  }
  const set = (v: NoteFontSize) => { current = typeof v === 'number' ? clampFont(v) : v; sync(); onChange(current) }
  auto?.addEventListener('click', () => set(current === 'auto' ? px() : 'auto'))
  minus.addEventListener('click', () => set(px() - 1))
  plus.addEventListener('click', () => set(px() + 1))
  slider.addEventListener('input', () => set(Number(slider.value)))
  input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9]/g, '').slice(0, 2) })
  const commit = () => { const n = parseInt(input.value, 10); if (Number.isFinite(n)) set(n); else sync() }
  input.addEventListener('blur', commit)
  input.addEventListener('focus', () => input.select())
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') { commit(); input.blur() }
    else if (e.key === 'Escape') { sync(); input.blur() }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(px() + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 4 : 1)) }
  })
  sync()
  return box
}
