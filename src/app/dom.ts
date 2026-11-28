/**
 * DOM helpers that Obsidian adds to every element and to `window` (createEl, createDiv, empty, addClass, …).
 * Plugins build all their UI with these, so they must exist before any plugin loads.
 */

export interface DomElementInfo {
  cls?: string | string[]
  text?: string | DocumentFragment
  attr?: Record<string, string | number | boolean | null>
  title?: string
  parent?: Node
  value?: string
  type?: string
  prepend?: boolean
  placeholder?: string
  href?: string
}

type Info = DomElementInfo | string
type Cb<T> = (el: T) => void

declare global {
  interface Node {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, callback?: Cb<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K]
    createDiv(o?: Info, callback?: Cb<HTMLDivElement>): HTMLDivElement
    createSpan(o?: Info, callback?: Cb<HTMLSpanElement>): HTMLSpanElement
    empty(): void
    detach(): void
    /** document / window the node lives in (Obsidian supports pop-out windows) */
    readonly doc: Document
    readonly win: Window
    instanceOf<T>(type: abstract new (...args: any[]) => T): this is T
    /** Delegated listener: fires for events inside `selector` elements, with that element as 2nd argument. */
    on(type: string, selector: string, listener: (ev: any, delegateTarget: HTMLElement) => any, options?: boolean | AddEventListenerOptions): void
    off(type: string, selector: string, listener: (ev: any, delegateTarget: HTMLElement) => any, options?: boolean | AddEventListenerOptions): void
  }
  interface Element {
    setText(val: string | DocumentFragment): void
    getText(): string
    addClass(...classes: string[]): void
    addClasses(classes: string[]): void
    removeClass(...classes: string[]): void
    removeClasses(classes: string[]): void
    toggleClass(classes: string | string[], value: boolean): void
    hasClass(cls: string): boolean
    setAttr(name: string, value: string | number | boolean | null): void
    setAttrs(obj: Record<string, string | number | boolean | null>): void
    getAttr(name: string): string | null
  }
  interface HTMLElement {
    show(): void
    hide(): void
    toggle(show: boolean): void
    isShown(): boolean
    onClickEvent(listener: (ev: MouseEvent) => any, options?: boolean | AddEventListenerOptions): void
  }
  function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, callback?: Cb<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K]
  function createDiv(o?: Info, callback?: Cb<HTMLDivElement>): HTMLDivElement
  function createSpan(o?: Info, callback?: Cb<HTMLSpanElement>): HTMLSpanElement
  function createFragment(callback?: Cb<DocumentFragment>): DocumentFragment
  // eslint-disable-next-line no-var
  var activeDocument: Document
  // eslint-disable-next-line no-var
  var activeWindow: Window
}

const split = (c: string | string[]) => (Array.isArray(c) ? c : c.split(' ')).filter(Boolean)

/** ARIA states need the words "true" / "false"; HTML boolean attributes (disabled, hidden…) are present or absent. */
function setAttr(el: Element, name: string, value: string | number | boolean | null) {
  if (value === null) el.removeAttribute(name)
  else if (name.startsWith('aria-')) el.setAttribute(name, String(value))
  else if (value === false) el.removeAttribute(name)
  else el.setAttribute(name, value === true ? '' : String(value))
}

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, parent: Node | null, tag: K, o: Info = {}, cb?: Cb<HTMLElementTagNameMap[K]>) {
  const info: DomElementInfo = typeof o === 'string' ? { cls: o } : o
  const el = doc.createElement(tag)
  if (info.cls) el.classList.add(...split(info.cls))
  if (info.text !== undefined) el.setText(info.text)
  if (info.attr) el.setAttrs(info.attr)
  if (info.title !== undefined) el.title = info.title
  for (const key of ['value', 'type', 'placeholder', 'href'] as const) {
    if (info[key] !== undefined) el.setAttribute(key, info[key]!)
    if (key === 'value' && info.value !== undefined && 'value' in el) (el as HTMLInputElement).value = info.value
  }
  const target = info.parent ?? parent
  if (target) {
    if (info.prepend) target.insertBefore(el, target.firstChild)
    else target.appendChild(el)
  }
  cb?.(el)
  return el
}

/** Adds the helpers to one window. Safe to call twice. */
export function installDom(win: Window & typeof globalThis) {
  const N = win.Node.prototype
  if (Object.hasOwn(N, 'createEl')) return
  const E = win.Element.prototype
  const H = win.HTMLElement.prototype
  const doc = win.document

  N.createEl = function (tag: any, o?: Info, cb?: Cb<any>) { return make(doc, this, tag, o, cb) }
  N.createDiv = function (o?: Info, cb?: Cb<any>) { return make(doc, this, 'div', o, cb) }
  N.createSpan = function (o?: Info, cb?: Cb<any>) { return make(doc, this, 'span', o, cb) }
  N.empty = function () { while (this.firstChild) this.removeChild(this.firstChild) }
  N.detach = function () { this.parentNode?.removeChild(this) }
  Object.defineProperty(N, 'doc', { get() { return this.ownerDocument ?? this }, configurable: true })
  Object.defineProperty(N, 'win', { get() { return (this.ownerDocument ?? this).defaultView ?? win }, configurable: true })
  N.instanceOf = function <T,>(this: Node, type: abstract new (...args: any[]) => T): this is T { return this instanceof type }
  const delegated = new WeakMap<Function, Map<string, EventListener>>()
  N.on = function (type, selector, listener, options) {
    const wrapped: EventListener = (ev) => {
      const target = (ev.target as Element | null)?.closest?.(selector)
      if (target && (this as Node).contains(target)) listener.call(this, ev, target as HTMLElement)
    }
    if (!delegated.has(listener)) delegated.set(listener, new Map())
    delegated.get(listener)!.set(`${type}|${selector}`, wrapped)
    this.addEventListener(type, wrapped, options)
  }
  N.off = function (type, selector, listener, options) {
    const wrapped = delegated.get(listener)?.get(`${type}|${selector}`)
    if (wrapped) this.removeEventListener(type, wrapped, options)
  }

  E.setText = function (val) {
    if (typeof val === 'string') this.textContent = val
    else { this.empty(); this.appendChild(val) }
  }
  E.getText = function () { return this.textContent ?? '' }
  E.addClass = function (...c) { this.classList.add(...c.flatMap(split)) }
  E.addClasses = function (c) { this.addClass(...c) }
  E.removeClass = function (...c) { this.classList.remove(...c.flatMap(split)) }
  E.removeClasses = function (c) { this.removeClass(...c) }
  E.toggleClass = function (c, value) { for (const x of split(c)) this.classList.toggle(x, value) }
  E.hasClass = function (c) { return this.classList.contains(c) }
  E.setAttr = function (name, value) { setAttr(this, name, value) }
  E.setAttrs = function (obj) { for (const [k, v] of Object.entries(obj)) setAttr(this, k, v) }
  E.getAttr = function (name) { return this.getAttribute(name) }

  H.show = function () { this.style.display = '' }
  H.hide = function () { this.style.display = 'none' }
  H.toggle = function (show) { if (show) this.show(); else this.hide() }
  H.isShown = function () { return !!this.offsetParent }
  H.onClickEvent = function (listener, options) { this.addEventListener('click', listener, options); this.addEventListener('auxclick', listener, options) }

  win.createEl = (tag: any, o?: Info, cb?: Cb<any>) => make(doc, null, tag, o, cb)
  win.createDiv = (o?: Info, cb?: Cb<any>) => make(doc, null, 'div', o, cb)
  win.createSpan = (o?: Info, cb?: Cb<any>) => make(doc, null, 'span', o, cb)
  win.createFragment = (cb?: Cb<DocumentFragment>) => { const f = doc.createDocumentFragment(); cb?.(f); return f }
  win.activeDocument = doc
  win.activeWindow = win
}
