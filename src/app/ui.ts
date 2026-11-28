/**
 * Modal, Notice and Setting (with its controls), named and structured as in Obsidian,
 * because plugins build their dialogs and settings pages with them.
 */
import type { App } from './app.js'
import { setIcon } from './icons.js'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, [href], [tabindex]:not([tabindex="-1"])'

export class Modal {
  app: App
  containerEl: HTMLElement
  modalEl: HTMLElement
  titleEl: HTMLElement
  contentEl: HTMLElement
  private returnFocus: Element | null = null

  constructor(app: App) {
    this.app = app
    this.containerEl = createDiv('modal-container')
    this.containerEl.createDiv('modal-bg').addEventListener('click', () => this.close())
    this.modalEl = this.containerEl.createDiv({ cls: 'modal', attr: { role: 'dialog', 'aria-modal': 'true' } })
    const close = this.modalEl.createEl('button', { cls: 'modal-close-button clickable-icon', attr: { 'aria-label': 'Закрити' } })
    setIcon(close, 'x')
    close.addEventListener('click', () => this.close())
    this.titleEl = this.modalEl.createDiv({ cls: 'modal-title', attr: { id: `modal-title-${Math.random().toString(36).slice(2)}` } })
    this.modalEl.setAttr('aria-labelledby', this.titleEl.id)
    this.contentEl = this.modalEl.createDiv('modal-content')
    this.containerEl.addEventListener('keydown', (e) => this.onKey(e))
  }

  setTitle(title: string) {
    this.titleEl.setText(title)
    return this
  }
  setContent(content: string | DocumentFragment) {
    this.contentEl.setText(content)
    return this
  }

  open() {
    this.returnFocus = document.activeElement
    document.body.appendChild(this.containerEl)
    this.onOpen()
    const first = this.contentEl.querySelector<HTMLElement>(FOCUSABLE) ?? this.modalEl.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
  }
  close() {
    if (!this.containerEl.isConnected) return
    this.containerEl.remove()
    this.onClose()
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus()
  }
  onOpen() {}
  onClose() {}

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    } else if (e.key === 'Tab') {
      // keep focus inside the dialog
      const items = [...this.modalEl.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) return
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1
      e.preventDefault()
      items[next].focus()
    }
  }
}

export class Notice {
  noticeEl: HTMLElement

  constructor(message: string | DocumentFragment, duration = 4000) {
    let box = document.body.querySelector<HTMLElement>('.notice-container')
    box ??= document.body.createDiv({ cls: 'notice-container', attr: { role: 'status', 'aria-live': 'polite' } })
    this.noticeEl = box.createDiv('notice')
    this.noticeEl.setText(message)
    this.noticeEl.addEventListener('click', () => this.hide())
    if (duration) setTimeout(() => this.hide(), duration)
  }
  setMessage(message: string | DocumentFragment) {
    this.noticeEl.setText(message)
    return this
  }
  hide() {
    this.noticeEl.remove()
  }
}

type Change<T> = (value: T) => any

abstract class ValueComponent<T> {
  disabled = false
  protected changeCb?: Change<T>
  abstract getValue(): T
  abstract setValue(value: T): this
  onChange(cb: Change<T>) {
    this.changeCb = cb
    return this
  }
  then(cb: (c: this) => any) {
    cb(this)
    return this
  }
}

export class TextComponent extends ValueComponent<string> {
  inputEl: HTMLInputElement
  constructor(containerEl: HTMLElement, tag: 'input' | 'textarea' = 'input') {
    super()
    this.inputEl = containerEl.createEl(tag as 'input', tag === 'input' ? { type: 'text' } : {})
    this.inputEl.addEventListener('input', () => this.changeCb?.(this.inputEl.value))
  }
  getValue() { return this.inputEl.value }
  setValue(value: string) { this.inputEl.value = value; return this }
  setPlaceholder(p: string) { this.inputEl.placeholder = p; return this }
  setDisabled(d: boolean) { this.disabled = d; this.inputEl.disabled = d; return this }
}

export class TextAreaComponent extends TextComponent {
  constructor(containerEl: HTMLElement) {
    super(containerEl, 'textarea')
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement
  private input: HTMLInputElement
  constructor(containerEl: HTMLElement) {
    super()
    // a real checkbox with role=switch: keyboard and screen readers work without extra code
    this.toggleEl = containerEl.createEl('label', 'checkbox-container')
    this.input = this.toggleEl.createEl('input', { type: 'checkbox', attr: { role: 'switch' } })
    this.input.addEventListener('change', () => {
      this.toggleEl.toggleClass('is-enabled', this.input.checked)
      this.changeCb?.(this.input.checked)
    })
  }
  getValue() { return this.input.checked }
  setValue(on: boolean) { this.input.checked = on; this.toggleEl.toggleClass('is-enabled', on); return this }
  setDisabled(d: boolean) { this.disabled = d; this.input.disabled = d; return this }
  setTooltip(t: string) { this.input.setAttr('aria-label', t); this.toggleEl.title = t; return this }
  /** @internal accessible name from the setting row */
  labelledBy(id: string) { this.input.setAttr('aria-labelledby', id); return this }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement
  constructor(containerEl: HTMLElement) {
    super()
    this.selectEl = containerEl.createEl('select', 'dropdown')
    this.selectEl.addEventListener('change', () => this.changeCb?.(this.selectEl.value))
  }
  addOption(value: string, display: string) { this.selectEl.createEl('option', { value, text: display }); return this }
  addOptions(options: Record<string, string>) { for (const [v, d] of Object.entries(options)) this.addOption(v, d); return this }
  getValue() { return this.selectEl.value }
  setValue(v: string) { this.selectEl.value = v; return this }
  setDisabled(d: boolean) { this.disabled = d; this.selectEl.disabled = d; return this }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement
  disabled = false
  constructor(containerEl: HTMLElement) {
    // a plain button: inside a form, Enter must not "press" whichever button happens to come first (e.g. «Скасувати»)
    this.buttonEl = containerEl.createEl('button', { attr: { type: 'button' } })
  }
  setButtonText(t: string) { this.buttonEl.setText(t); return this }
  setIcon(icon: string) { setIcon(this.buttonEl, icon); return this }
  setCta() { this.buttonEl.addClass('mod-cta'); return this }
  removeCta() { this.buttonEl.removeClass('mod-cta'); return this }
  setWarning() { this.buttonEl.addClass('mod-warning'); return this }
  setTooltip(t: string) { this.buttonEl.setAttr('aria-label', t); this.buttonEl.title = t; return this }
  setDisabled(d: boolean) { this.disabled = d; this.buttonEl.disabled = d; return this }
  setClass(c: string) { this.buttonEl.addClass(c); return this }
  onClick(cb: (evt: MouseEvent) => any) { this.buttonEl.addEventListener('click', cb); return this }
  then(cb: (c: this) => any) { cb(this); return this }
}

export class ExtraButtonComponent extends ButtonComponent {
  constructor(containerEl: HTMLElement) {
    super(containerEl)
    this.buttonEl.addClass('clickable-icon', 'extra-setting-button')
  }
}

export class Setting {
  settingEl: HTMLElement
  infoEl: HTMLElement
  nameEl: HTMLElement
  descEl: HTMLElement
  controlEl: HTMLElement
  components: unknown[] = []

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv('setting-item')
    this.infoEl = this.settingEl.createDiv('setting-item-info')
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name', attr: { id: `setting-${Math.random().toString(36).slice(2)}` } })
    this.descEl = this.infoEl.createDiv('setting-item-description')
    this.controlEl = this.settingEl.createDiv('setting-item-control')
  }

  setName(name: string | DocumentFragment) { this.nameEl.setText(name); return this }
  setDesc(desc: string | DocumentFragment) { this.descEl.setText(desc); return this }
  setClass(cls: string) { this.settingEl.addClass(cls); return this }
  setHeading() { this.settingEl.addClass('setting-item-heading'); this.nameEl.setAttr('role', 'heading'); return this }
  setDisabled(d: boolean) { this.settingEl.toggleClass('is-disabled', d); return this }
  then(cb: (s: this) => any) { cb(this); return this }

  private add<T>(c: T, cb: (c: T) => any) {
    this.components.push(c)
    cb(c)
    return this
  }
  private label<T extends { inputEl?: HTMLElement; selectEl?: HTMLElement }>(c: T) {
    ;(c.inputEl ?? c.selectEl)?.setAttr('aria-labelledby', this.nameEl.id)
    return c
  }
  addText(cb: (c: TextComponent) => any) { return this.add(this.label(new TextComponent(this.controlEl)), cb) }
  addTextArea(cb: (c: TextAreaComponent) => any) { return this.add(this.label(new TextAreaComponent(this.controlEl)), cb) }
  addToggle(cb: (c: ToggleComponent) => any) { return this.add(new ToggleComponent(this.controlEl).labelledBy(this.nameEl.id), cb) }
  addDropdown(cb: (c: DropdownComponent) => any) { return this.add(this.label(new DropdownComponent(this.controlEl)), cb) }
  addButton(cb: (c: ButtonComponent) => any) { return this.add(new ButtonComponent(this.controlEl), cb) }
  addExtraButton(cb: (c: ExtraButtonComponent) => any) { return this.add(new ExtraButtonComponent(this.controlEl), cb) }
}

/** Context menu with Obsidian's DOM (`.menu > .menu-item > .menu-item-icon + .menu-item-title`). */
export class MenuItem {
  dom: HTMLElement
  iconEl: HTMLElement
  titleEl: HTMLElement
  disabled = false
  private callback?: (evt: MouseEvent | KeyboardEvent) => any

  constructor(private readonly menu: Menu) {
    this.dom = createDiv({ cls: 'menu-item', attr: { role: 'menuitem', tabindex: '-1' } })
    this.iconEl = this.dom.createDiv('menu-item-icon')
    this.titleEl = this.dom.createDiv('menu-item-title')
    this.dom.addEventListener('click', (e) => this.run(e))
    this.dom.addEventListener('mousemove', () => this.dom.focus())
  }
  /** @internal */
  run(evt: MouseEvent | KeyboardEvent) {
    if (this.disabled) return
    this.menu.hide()
    try { this.callback?.(evt) } catch (e) { console.error(e) }
  }
  setTitle(title: string | DocumentFragment) { this.titleEl.setText(title); return this }
  setIcon(icon: string | null) { this.iconEl.empty(); if (icon) setIcon(this.iconEl, icon); return this }
  setChecked(checked: boolean | null) { this.dom.toggleClass('mod-checked', !!checked); this.dom.setAttr('aria-checked', checked ?? null); return this }
  setDisabled(disabled: boolean) { this.disabled = disabled; this.dom.toggleClass('is-disabled', disabled); this.dom.setAttr('aria-disabled', disabled || null); return this }
  setWarning(warning: boolean) { this.dom.toggleClass('is-warning', warning); return this }
  setIsLabel(label: boolean) { this.dom.toggleClass('is-label', label); return this }
  /** shortcut: sections only keep insertion order. */
  setSection(_section: string) { return this }
  onClick(callback: (evt: MouseEvent | KeyboardEvent) => any) { this.callback = callback; return this }
}

export class Menu {
  dom: HTMLElement
  items: MenuItem[] = []
  private hideCallbacks: (() => any)[] = []
  private returnFocus: Element | null = null
  // pointerdown, not mousedown: the canvas cancels the mouse events of a press (no text selection while dragging)
  private readonly onOutside = (e: Event) => { if (!this.dom.contains(e.target as Node)) this.hide() }

  constructor() {
    this.dom = createDiv({ cls: 'menu', attr: { role: 'menu' } })
    this.dom.addEventListener('keydown', (e) => this.onKey(e))
  }

  addItem(cb: (item: MenuItem) => any) {
    const item = new MenuItem(this)
    this.items.push(item)
    this.dom.appendChild(item.dom)
    cb(item)
    return this
  }
  addSeparator() {
    this.dom.createDiv({ cls: 'menu-separator', attr: { role: 'separator' } })
    return this
  }
  setNoIcon() { this.dom.addClass('mod-no-icon'); return this }
  setUseNativeMenu(_native: boolean) { return this }
  onHide(cb: () => any) { this.hideCallbacks.push(cb) }

  showAtMouseEvent(evt: MouseEvent) {
    evt.preventDefault()
    return this.showAtPosition({ x: evt.clientX, y: evt.clientY })
  }
  showAtPosition(pos: { x: number; y: number }) {
    this.returnFocus = document.activeElement
    document.body.appendChild(this.dom)
    const { innerWidth: w, innerHeight: h } = window
    const r = this.dom.getBoundingClientRect()
    this.dom.style.left = `${Math.max(4, Math.min(pos.x, w - r.width - 4))}px`
    this.dom.style.top = `${Math.max(4, Math.min(pos.y, h - r.height - 4))}px`
    document.addEventListener('pointerdown', this.onOutside, true)
    this.items.find((i) => !i.disabled)?.dom.focus()
    return this
  }
  hide() {
    if (!this.dom.isConnected || this.dom.hasClass('is-closing')) return this
    document.removeEventListener('pointerdown', this.onOutside, true)
    // exit animation (CSS `.menu.is-closing`); removed at once without matchMedia (tests) or under reduced motion
    const still = typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) this.dom.remove()
    else {
      this.dom.addClass('is-closing')
      const remove = () => this.dom.remove()
      this.dom.addEventListener('animationend', remove, { once: true })
      setTimeout(remove, 250)
    }
    for (const cb of this.hideCallbacks) cb()
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus()
    return this
  }
  close() { return this.hide() }

  private onKey(e: KeyboardEvent) {
    const items = this.items.filter((i) => !i.disabled)
    const i = items.findIndex((it) => it.dom === document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.dom.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      items[i]?.run(e)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.hide()
    }
  }
}
