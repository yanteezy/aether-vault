// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installDom } from './dom.js'
import { undoToast } from './undoToast.js'

installDom(window)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('undoToast', () => {
  it('counts down, pauses while hovered, then goes away without calling undo', async () => {
    let undone = false
    const t = undoToast('Done', () => { undone = true }, 1)
    expect(t.el.querySelector('.undo-toast-count')!.textContent).toBe('1')
    expect(t.el.style.getPropertyValue('--undo-ms')).toBe('1000ms')

    t.el.dispatchEvent(new Event('pointerenter'))
    expect(t.el.classList.contains('is-paused')).toBe(true)
    await wait(1300)
    expect(t.el.isConnected).toBe(true) // paused: still there

    t.el.dispatchEvent(new Event('pointerleave'))
    await wait(1700)
    expect(document.querySelector('.undo-toast')).toBeNull()
    expect(document.querySelector('.undo-toast-host')).toBeNull()
    expect(undone).toBe(false)
  })

  it('Ctrl+Z undoes the newest toast, but not while typing in a text field', async () => {
    const calls: string[] = []
    undoToast('First', () => { calls.push('first') })
    undoToast('Second', () => { calls.push('second') })
    const input = document.body.createEl('input')
    input.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'я', ctrlKey: true, bubbles: true }))
    expect(calls).toEqual([]) // the field keeps its own undo
    input.blur()
    input.remove()
    const canvas = document.body.createDiv({ cls: 'canvas-wrapper', attr: { tabindex: '0' } })
    canvas.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true }))
    expect(calls).toEqual([]) // the canvas undoes its own, newer changes
    canvas.blur()
    canvas.remove()
    const z = new KeyboardEvent('keydown', { code: 'KeyZ', key: 'я', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(z)
    await wait(20)
    expect(calls).toEqual(['second'])
    expect(z.defaultPrevented).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true }))
    await wait(450)
    expect(calls).toEqual(['second', 'first'])
    expect(document.querySelector('.undo-toast')).toBeNull()
  })

  it('«Скасувати» runs undo once and closes', async () => {
    let calls = 0
    const t = undoToast('Done', async () => { calls++ })
    const b = t.el.querySelector<HTMLButtonElement>('.undo-toast-undo')!
    b.click()
    b.click()
    await wait(450)
    expect(calls).toBe(1)
    expect(t.el.isConnected).toBe(false)
  })
})
