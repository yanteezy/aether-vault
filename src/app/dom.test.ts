// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Component } from './component.js'
import { installDom } from './dom.js'
import { Events } from '../core/events.js'
import { addIcon, setIcon } from './icons.js'

installDom(window)

describe('DOM helpers', () => {
  it('createEl takes cls, text, attr, parent and a callback', () => {
    const parent = createDiv()
    const cb = vi.fn()
    const el = parent.createEl('button', { cls: 'a b', text: 'Hi', attr: { 'aria-label': 'x', disabled: true, hidden: null } }, cb)
    expect(el.parentElement).toBe(parent)
    expect(el.className).toBe('a b')
    expect(el.textContent).toBe('Hi')
    expect(el.getAttribute('aria-label')).toBe('x')
    expect(el.hasAttribute('disabled')).toBe(true)
    expect(cb).toHaveBeenCalledWith(el)
    expect(parent.createSpan('only-class').className).toBe('only-class')
    // ARIA states keep "false"; boolean HTML attributes disappear
    el.setAttrs({ 'aria-pressed': false, 'aria-expanded': true, disabled: false })
    expect(el.getAttribute('aria-pressed')).toBe('false')
    expect(el.getAttribute('aria-expanded')).toBe('true')
    expect(el.hasAttribute('disabled')).toBe(false)
  })

  it('class helpers, empty, show / hide', () => {
    const el = createDiv('x')
    el.addClass('y', 'z')
    el.toggleClass('x', false)
    expect(el.className).toBe('y z')
    expect(el.hasClass('z')).toBe(true)
    el.createDiv()
    el.empty()
    expect(el.childNodes.length).toBe(0)
    el.hide()
    expect(el.style.display).toBe('none')
    el.toggle(true)
    expect(el.style.display).toBe('')
  })
})

describe('icons', () => {
  it('draws Lucide icons by Obsidian id, old names too; unknown ids stay empty', () => {
    const el = createDiv()
    setIcon(el, 'file-plus')
    expect(el.querySelector('svg.lucide-file-plus path')).not.toBeNull()
    setIcon(el, 'hashtag') // legacy Obsidian name
    expect(el.querySelector('svg')).not.toBeNull()
    addIcon('my-icon', '<circle cx="50" cy="50" r="40"/>')
    setIcon(el, 'my-icon')
    expect(el.querySelector('svg circle')).not.toBeNull()
    setIcon(el, 'no-such-icon')
    expect(el.childNodes.length).toBe(0)
  })
})

describe('Component', () => {
  it('undoes everything it registered, children first', () => {
    const order: string[] = []
    const events = new Events()
    const listener = vi.fn()
    const parent = new (class extends Component { onunload() { order.push('parent') } })()
    const child = new (class extends Component { onunload() { order.push('child') } })()
    const button = createEl('button')
    const click = vi.fn()

    parent.load()
    parent.addChild(child)
    parent.registerEvent(events.on('x', listener))
    parent.registerDomEvent(button, 'click', click)
    parent.register(() => order.push('cleanup'))
    parent.unload()

    events.trigger('x')
    button.click()
    expect(listener).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(order).toEqual(['child', 'cleanup', 'parent'])
  })
})
