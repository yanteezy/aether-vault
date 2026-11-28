/**
 * The card's right-click menu, ported from Aether 0.2.24's NoteMenu: edit, card type, title alignment, text size,
 * font, photo, size, colour, duplicate / copy / open, order, pin, connect / unlink, delete (second click confirms).
 * Aether's own properties live on the JSON Canvas node under `aether-*` keys (unknown to Obsidian, kept by it).
 */
import { cardFontPx, fontSizeControl, fontTiles, loadAppearance, type NoteFont, type NoteFontSize } from '../appearance.js'
import type { CanvasNode } from '../../core/canvas/canvasData.js'

export type NoteStyle = 'plain' | 'headline' | 'caps' | 'banner' | 'quote' | 'bullets'
export type TitleAlign = 'left' | 'center' | 'right'
export type TitleVAlign = 'top' | 'middle' | 'bottom'
export interface CardImage { file: string; fit?: 'cover' | 'contain'; dim?: number }

/** Aether's card fields on a JSON Canvas node. */
export interface AetherCard {
  'aether-style'?: NoteStyle
  'aether-titleAlign'?: TitleAlign
  /** where the text sits in the card, top to bottom */
  'aether-titleVAlign'?: TitleVAlign
  'aether-fontSize'?: NoteFontSize
  'aether-font'?: NoteFont
  'aether-locked'?: boolean
  'aether-image'?: CardImage
  /** tags dropped on a text card (a note card keeps them in its frontmatter) */
  'aether-tags'?: string[]
}
export const card = (n: CanvasNode) => n as CanvasNode & AetherCard
/** A banner is only its title, so it sits in the middle; the other types start at the top. */
export const vAlignOf = (c: AetherCard): TitleVAlign => c['aether-titleVAlign'] ?? (c['aether-style'] === 'banner' ? 'middle' : 'top')

export const NOTE_STYLES: { id: NoteStyle; label: string; hint: string }[] = [
  { id: 'plain', label: 'Звичайна', hint: 'Назва і текст' },
  { id: 'headline', label: 'Заголовок', hint: 'Велика назва, нижче звичайний рядок' },
  { id: 'caps', label: 'ЗАГЛАВНІ', hint: 'Назва великими літерами з лінією' },
  { id: 'banner', label: 'Банер', hint: 'Тільки велика назва' },
  { id: 'quote', label: 'Цитата', hint: 'Текст курсивом, назва — підпис' },
  { id: 'bullets', label: 'Список', hint: 'Кожен рядок тексту — пункт' },
]
const ALIGNS: { id: TitleAlign; label: string; path: string }[] = [
  { id: 'left', label: 'Ліворуч', path: 'M2 3h10M2 7h6M2 11h8' },
  { id: 'center', label: 'По центру', path: 'M2 3h10M4 7h6M3 11h8' },
  { id: 'right', label: 'Праворуч', path: 'M2 3h10M6 7h6M4 11h8' },
]
const VALIGNS: { id: TitleVAlign; label: string; path: string }[] = [
  { id: 'top', label: 'Зверху', path: 'M2 2h10M5 5h4' },
  { id: 'middle', label: 'Посередині', path: 'M2 7h10M5 4.5v5M9 4.5v5' },
  { id: 'bottom', label: 'Знизу', path: 'M2 12h10M5 9h4' },
]
/** Aether's 8 colours as JSON Canvas colours (presets where one exists, else hex). */
export const NOTE_COLORS: { id: string; label: string; value: string | undefined; swatch: string }[] = [
  { id: 'default', label: 'Без кольору', value: undefined, swatch: 'rgba(255,255,255,0.18)' },
  { id: 'accent', label: 'Акцент', value: '#0a84ff', swatch: '#0a84ff' },
  { id: 'yellow', label: 'Жовтий', value: '3', swatch: 'var(--canvas-color-3)' },
  { id: 'green', label: 'Зелений', value: '4', swatch: 'var(--canvas-color-4)' },
  { id: 'blue', label: 'Синій', value: '5', swatch: 'var(--canvas-color-5)' },
  { id: 'pink', label: 'Рожевий', value: '#ff6fae', swatch: '#ff6fae' },
  { id: 'purple', label: 'Фіолетовий', value: '6', swatch: 'var(--canvas-color-6)' },
  { id: 'gray', label: 'Сірий', value: '#8e8e93', swatch: '#8e8e93' },
]

const NOTE_MIN_W = 180
const NOTE_MIN_H = 100
const NOTE_MAX = 2000
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

/** What the menu asks the canvas to do. */
export interface NoteMenuHost {
  patch(n: CanvasNode, patch: Record<string, unknown>): void
  duplicate(ids: string[]): void
  copyText(n: CanvasNode): Promise<boolean>
  openInNotes(n: CanvasNode): void
  front(n: CanvasNode): void
  back(n: CanvasNode): void
  connect(n: CanvasNode): void
  unlink(n: CanvasNode): void
  linkCount(n: CanvasNode): number
  remove(n: CanvasNode): void
  pickImage(n: CanvasNode): void
  removeImage(n: CanvasNode): void
  tags(n: CanvasNode): string[]
  removeTag(n: CanvasNode, tag: string): void
}

let open: { close: () => void } | null = null

export function closeNoteMenu() {
  open?.close()
}

/** `count` > 1: the card is part of a selection and every change goes to all of it. */
export function openNoteMenu(host: NoteMenuHost, n: CanvasNode, title: string, at: { x: number; y: number }, count = 1) {
  closeNoteMenu()
  const c = card(n)
  const returnFocus = document.activeElement as HTMLElement | null
  const el = document.body.createDiv({ cls: 'menu note-menu', attr: { role: 'dialog', 'aria-label': 'Налаштування нотатки' } }) // a dialog, not a menu: it holds fields, a slider and radios (WCAG 4.1.2)
  const close = () => {
    if (!el.isConnected) return
    el.remove()
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('wheel', close)
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    if (open?.close === close) open = null
    returnFocus?.focus?.({ preventScroll: true })
  }
  const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) close() }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
  const run = (fn: () => void) => () => { close(); fn() }
  // where the helpers below add their rows: the menu itself, or the folded «Вигляд картки» section
  // the menu's rim lives on `el`; only this inner body scrolls, so the rim always follows the menu's edge
  const body = el.createDiv('note-menu__scroll')
  let box: HTMLElement = body
  const item = (label: string, onClick: () => void, extra?: { kbd?: string; count?: number; danger?: boolean; disabled?: boolean; pressed?: boolean }) => {
    const b = box.createEl('button', { cls: `menu-item note-menu__item${extra?.danger ? ' is-danger is-warning' : ''}`, attr: extra?.pressed !== undefined ? { 'aria-pressed': extra.pressed } : {} })
    b.createSpan({ cls: 'menu-item-title', text: label })
    if (extra?.count) b.createSpan({ cls: 'note-menu__count', text: String(extra.count) })
    if (extra?.kbd) b.createEl('kbd', { text: extra.kbd })
    b.disabled = !!extra?.disabled
    b.addEventListener('click', onClick)
    return b
  }
  const sep = () => box.createDiv({ cls: 'menu-separator', attr: { role: 'separator' } })
  const row = (label: string) => {
    const r = box.createDiv('note-menu__row')
    r.createSpan({ cls: 'note-menu__label', text: label })
    return r
  }
  const block = (label: string) => {
    const r = box.createDiv('note-menu__block')
    r.createSpan({ cls: 'note-menu__label', text: label })
    return r
  }
  const seg = (parent: HTMLElement, aria: string) => parent.createDiv({ cls: 'note-menu__seg', attr: { role: 'radiogroup', 'aria-label': aria } })

  body.createDiv({ cls: 'note-menu__title', text: title || 'Без назви', attr: { title } })

  const color = NOTE_COLORS.find((x) => x.value === n.color)?.id ?? (n.color ? '' : 'default')
  const swatches = row('Колір').createDiv({ cls: 'note-menu__swatches', attr: { role: 'radiogroup', 'aria-label': 'Колір нотатки' } })
  for (const col of NOTE_COLORS) {
    const b = swatches.createEl('button', { cls: `note-menu__swatch${color === col.id ? ' is-active' : ''}`, attr: { role: 'radio', 'aria-checked': color === col.id, 'aria-label': col.label, title: col.label } })
    b.style.setProperty('--swatch', col.swatch)
    b.addEventListener('click', () => {
      for (const x of swatches.children) { x.removeClass('is-active'); x.setAttr('aria-checked', false) }
      b.addClass('is-active'); b.setAttr('aria-checked', true)
      host.patch(n, { color: col.value })
    })
  }

  sep()
  item('Дублювати', run(() => host.duplicate([n.id])), { kbd: `${mod}D` })
  const copy = item('Копіювати текст', () => void host.copyText(n).then((ok) => {
    if (!ok) return close()
    copy.querySelector('.menu-item-title')!.setText('Скопійовано ✓')
    window.setTimeout(close, 650)
  }))
  if (count === 1) item('Відкрити в «Нотатки»', run(() => host.openInNotes(n)))

  sep()
  item('На передній план', run(() => host.front(n)))
  item('На задній план', run(() => host.back(n)))
  item(c['aether-locked'] ? 'Відкріпити позицію' : 'Закріпити позицію', run(() => host.patch(n, { 'aether-locked': c['aether-locked'] ? undefined : true })), { pressed: !!c['aether-locked'] })
  item('Зʼєднати з…', run(() => host.connect(n)))
  const links = host.linkCount(n)
  item('Від’єднати зв’язки', run(() => host.unlink(n)), { disabled: !links, count: links })

  // rarely changed looks fold away, so the everyday actions and «Видалити» fit without scrolling
  sep()
  // folded each time the menu opens: «Вигляд картки» stays open only for this menu
  const lookBtn = body.createEl('button', { cls: 'menu-item note-menu__item note-menu__fold', attr: { 'aria-expanded': false, 'aria-controls': 'note-menu-look' } })
  lookBtn.createSpan({ cls: 'menu-item-title', text: 'Вигляд картки' })
  lookBtn.createSpan({ cls: 'note-menu__chevron', attr: { 'aria-hidden': 'true' } })
  const look = body.createDiv({ cls: 'note-menu__look', attr: { id: 'note-menu-look' } })
  look.hidden = true
  lookBtn.addEventListener('click', () => {
    look.hidden = !look.hidden
    lookBtn.setAttr('aria-expanded', !look.hidden)
    place()
  })
  box = look
  if (n.type !== 'group') {
    const styles = box.createDiv({ cls: 'note-menu__styles', attr: { role: 'radiogroup', 'aria-label': 'Тип нотатки' } })
    const current = c['aether-style'] ?? 'plain'
    for (const st of NOTE_STYLES) {
      const b = styles.createEl('button', { cls: `note-menu__style note-menu__style--${st.id}${current === st.id ? ' is-active' : ''}`, attr: { role: 'radio', 'aria-checked': current === st.id, title: st.hint } })
      const glyph = b.createSpan({ cls: 'note-menu__style-glyph', attr: { 'aria-hidden': 'true' } })
      glyph.createEl('i'); glyph.createEl('i'); glyph.createEl('i')
      b.createSpan({ cls: 'note-menu__style-label', text: st.label })
      b.addEventListener('click', () => {
        for (const x of styles.children) { x.removeClass('is-active'); x.setAttr('aria-checked', false) }
        b.addClass('is-active'); b.setAttr('aria-checked', true)
        host.patch(n, { 'aether-style': st.id === 'plain' ? undefined : st.id })
        showV()
      })
    }

    const align = c['aether-titleAlign'] ?? 'center' // titles are centred unless the card says otherwise
    const alignSeg = seg(row('Назва'), 'Вирівнювання назви')
    for (const al of ALIGNS) {
      const b = alignSeg.createEl('button', { cls: align === al.id ? 'is-active' : '', attr: { role: 'radio', 'aria-checked': align === al.id, 'aria-label': al.label, title: al.label } })
      b.innerHTML = `<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="${al.path}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
      b.addEventListener('click', () => {
        for (const x of alignSeg.children) { x.removeClass('is-active'); x.setAttr('aria-checked', false) }
        b.addClass('is-active'); b.setAttr('aria-checked', true)
        host.patch(n, { 'aether-titleAlign': al.id === 'center' ? undefined : al.id })
      })
    }

    const vSeg = seg(row('Положення'), 'Положення тексту в картці')
    const vBtns = VALIGNS.map((v) => {
      const b = vSeg.createEl('button', { attr: { role: 'radio', 'aria-label': v.label, title: v.label } })
      b.innerHTML = `<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-opacity="0.45"/><path d="${v.path}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
      b.addEventListener('click', () => {
        // stored only when it differs from what the card type does anyway
        host.patch(n, { 'aether-titleVAlign': undefined })
        if (vAlignOf(c) !== v.id) host.patch(n, { 'aether-titleVAlign': v.id })
        showV()
      })
      return { v, b }
    })
    function showV() { const now = vAlignOf(c); for (const { v, b } of vBtns) { b.toggleClass('is-active', v.id === now); b.setAttr('aria-checked', v.id === now) } }
    showV()

    const a = loadAppearance()
    const own = c['aether-fontSize']
    fontSizeControl(block('Розмір тексту'), own ?? (a.autoTextSize ? 'auto' : undefined), cardFontPx(a, own, n.width, n.height), (v) => host.patch(n, { 'aether-fontSize': v }), true)
    fontTiles(block('Шрифт'), c['aether-font'], (v) => host.patch(n, { 'aether-font': v }), true)

    sep()
    const img = c['aether-image']
    if (img) {
      const fitSeg = seg(row('Фото'), 'Як показати фото')
      for (const [f, label] of [['cover', 'Заповнити'], ['contain', 'Вмістити']] as const) {
        const b = fitSeg.createEl('button', { text: label, cls: (img.fit ?? 'cover') === f ? 'is-active' : '', attr: { role: 'radio', 'aria-checked': (img.fit ?? 'cover') === f } })
        b.addEventListener('click', () => {
          for (const x of fitSeg.children) { x.removeClass('is-active'); x.setAttr('aria-checked', false) }
          b.addClass('is-active'); b.setAttr('aria-checked', true)
          host.patch(n, { 'aether-image': { ...img, fit: f } })
        })
      }
      const dim = row('Затемнення').createEl('input', { type: 'range', cls: 'note-menu__range', attr: { min: 0, max: 80, step: 5, 'aria-label': 'Затемнення' } })
      dim.value = String(Math.round((img.dim ?? 0) * 100))
      dim.addEventListener('input', () => host.patch(n, { 'aether-image': { ...img, dim: Number(dim.value) / 100 } }))
      item('Замінити фото…', run(() => host.pickImage(n)))
      item('Прибрати фото', run(() => host.removeImage(n)))
    } else {
      item('Додати фото…', run(() => host.pickImage(n)))
    }
  }

  const dims = row('Розмір').createDiv('note-menu__dims')
  numField(dims, 'Ш', 'Ширина, px', Math.round(n.width), NOTE_MIN_W, !!c['aether-locked'], (width) => host.patch(n, { width }))
  dims.createSpan({ cls: 'note-menu__times', text: '×' })
  numField(dims, 'В', 'Висота, px', Math.round(n.height), NOTE_MIN_H, !!c['aether-locked'], (height) => host.patch(n, { height }))

  box = body

  const tags = count === 1 ? host.tags(n) : []
  if (tags.length) {
    sep()
    for (const tag of tags) item(`Прибрати тег ${tag}`, run(() => host.removeTag(n, tag)))
  }

  sep()
  let confirming = false
  const del = item(count > 1 ? `Видалити (${count})` : 'Видалити', () => {
    if (confirming) return run(() => host.remove(n))()
    confirming = true
    del.addClass('is-confirm')
    del.querySelector('.menu-item-title')!.setText('Натисніть ще раз, щоб видалити')
    del.querySelector('kbd')?.remove()
  }, { kbd: '⌫', danger: true })

  // keep the menu inside the window (layout size, not the animated one)
  function place() {
    const pad = 8
    let x = at.x
    let y = at.y
    if (x + el.offsetWidth > window.innerWidth - pad) x = Math.max(pad, at.x - el.offsetWidth)
    if (y + el.offsetHeight > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - pad - el.offsetHeight)
    Object.assign(el.style, { left: `${x}px`, top: `${y}px` })
  }
  place()
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.addEventListener('wheel', (e) => e.stopPropagation())
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('wheel', close, { passive: true })
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  el.querySelector<HTMLElement>('.note-menu__item')?.focus({ preventScroll: true })
  open = { close }
  return el
}

/** Small numeric field: type a number, ↑/↓ steps by 10 (⇧ — by 50). */
function numField(parent: HTMLElement, label: string, title: string, value: number, min: number, disabled: boolean, onChange: (v: number) => void) {
  const wrap = parent.createEl('label', { cls: `note-menu__num${disabled ? ' is-disabled' : ''}`, attr: { title } })
  wrap.createSpan({ text: label })
  const input = wrap.createEl('input', { attr: { inputmode: 'numeric', 'aria-label': title } })
  input.disabled = disabled
  let current = value
  input.value = String(value)
  const set = (v: number) => { current = Math.min(NOTE_MAX, Math.max(min, Math.round(v))); input.value = String(current); onChange(current) }
  const commit = () => { const v = parseInt(input.value, 10); if (Number.isFinite(v)) set(v); else input.value = String(current) }
  input.addEventListener('focus', () => input.select())
  input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9]/g, '').slice(0, 4) })
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') { commit(); input.blur() }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(current + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 50 : 10)) }
  })
}
