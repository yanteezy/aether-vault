/**
 * The vault name at the bottom of the sidebar is a button: it opens a small glass card that springs up from it
 * and asks whether to switch to another folder. «Обрати папку…» runs the folder picker (`app.onOpenVault`);
 * «Скасувати», Escape or a press elsewhere close the card and give focus back to the button.
 */
import type { App } from './app.js'

export function openVaultSwitch(app: App, anchor: HTMLElement) {
  if (document.querySelector('.vault-switch')) return
  const card = document.body.createDiv({ cls: 'vault-switch', attr: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'vault-switch-title' } })
  card.createDiv({ cls: 'vault-switch-title', text: 'Змінити папку сховища?', attr: { id: 'vault-switch-title' } })
  card.createDiv({ cls: 'vault-switch-text', text: 'Зараз відкрито:' })
  card.createDiv({ cls: 'vault-switch-path', text: app.vault.adapter.getBasePath() })
  card.createDiv({ cls: 'vault-switch-text', text: 'Відкриються нотатки з іншої папки. Ця папка лишиться як є.' })
  const row = card.createDiv('vault-switch-actions')
  const cancel = row.createEl('button', { cls: 'vault-switch-cancel', text: 'Скасувати', attr: { type: 'button' } })
  const pick = row.createEl('button', { cls: 'vault-switch-pick mod-cta', text: 'Обрати папку…', attr: { type: 'button' } })

  // spring up from the button: the card's bottom-left corner sits just above it
  const r = anchor.getBoundingClientRect()
  Object.assign(card.style, { left: `${Math.max(8, r.left)}px`, bottom: `${Math.max(8, window.innerHeight - r.top + 8)}px` })
  anchor.setAttr('aria-expanded', true)

  const close = () => {
    if (!card.isConnected || card.hasClass('is-leaving')) return
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('keydown', key, true)
    anchor.setAttr('aria-expanded', false)
    card.addClass('is-leaving')
    const remove = () => card.remove()
    card.addEventListener('animationend', remove, { once: true })
    window.setTimeout(remove, 300) // reduced motion: no animationend
    anchor.focus()
  }
  const outside = (e: PointerEvent) => { if (!card.contains(e.target as Node) && !anchor.contains(e.target as Node)) close() }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('keydown', key, true)
  cancel.addEventListener('click', close)
  pick.addEventListener('click', () => { close(); app.onOpenVault() })
  pick.focus()
  return card
}
