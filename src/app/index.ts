/** Page start: open the last vault (or the one from `--vault=`), or show the welcome screen. */
import { existsSync, statSync } from 'node:fs'
import { ipcRenderer } from 'electron'
import { App } from './app.js'
import { installDom } from './dom.js'
import { applyAppearance, loadAppearance } from './appearance.js'
import { installGlassLight } from './glassLight.js'
import { legacyText, moveLegacyAndOpen } from './updates.js'

const LAST_VAULT = 'last-vault'

installDom(window)
// glass light over the header: there the page gets no mouse events (window drag area), so ask the main process
let trackingCursor = false
document.documentElement.addEventListener('mouseleave', () => { trackingCursor = true; ipcRenderer.send('cursor:track', true) })
window.addEventListener('pointermove', () => { if (trackingCursor) { trackingCursor = false; ipcRenderer.send('cursor:track', false) } }, { passive: true })
ipcRenderer.on('cursor:pos', (_e, p: { x: number; y: number } | null) => window.dispatchEvent(new CustomEvent('aether:pointer', { detail: p })))
applyAppearance(loadAppearance())
installGlassLight()
document.body.toggleClass('reduce-transparency', !!localStorage.getItem('reduce-transparency'))
// inactive window: chrome dims like a native macOS window (WWDC26 appearsActive); only after the first blur
window.addEventListener('blur', () => document.body.addClass('is-window-inactive'))
window.addEventListener('focus', () => document.body.removeClass('is-window-inactive'))

async function pickVault() {
  const dir: string | null = await ipcRenderer.invoke('vault:pick')
  if (!dir) return
  await app?.flush()
  localStorage.setItem(LAST_VAULT, dir)
  ipcRenderer.send('app:reload') // location.reload() is blocked like any page navigation
}

function welcome(missing?: string) {
  const box = document.body.createDiv('app-container mod-welcome').createDiv('aether-welcome')
  box.createEl('h1', { text: 'Aether' })
  box.createEl('p', { text: missing ? `Папку «${missing}» не знайдено. Оберіть сховище ще раз.` : 'Сховище — це звичайна папка з нотатками в Markdown.' })
  const open = box.createEl('button', { cls: 'aether-button mod-cta', text: 'Відкрити папку сховища' })
  open.addEventListener('click', () => void pickVault())
  // after the update from the old Aether: offer its notes first (copied into new folders; the old data stays as it was)
  void ipcRenderer.invoke('legacy:find').then((legacy: { vaults: number; notes: number; target: string } | null) => {
    if (!legacy || missing) return
    const card = createDiv('aether-welcome-legacy')
    card.createEl('h2', { text: 'Ваші нотатки зі старого Aether' })
    card.createEl('p', { text: `Знайдено ${legacyText(legacy)}. Aether скопіює їх у нові папки в «${legacy.target}» і відкриє. Старі дані не зміняться.` })
    const go = card.createEl('button', { cls: 'aether-button mod-cta', text: 'Перенести нотатки' })
    const status = card.createDiv({ cls: 'claude-status', attr: { role: 'status', 'aria-live': 'polite' } })
    go.addEventListener('click', async () => {
      go.disabled = true
      status.setText('Переношу…')
      try {
        if (!(await moveLegacyAndOpen())) { status.setText('Нотаток не знайдено.'); go.disabled = false }
      } catch (e) {
        status.className = 'claude-status is-error'
        status.setText(`Не вдалося перенести: ${e instanceof Error ? e.message : e}`)
        go.disabled = false
      }
    })
    open.before(card)
    open.className = 'aether-button' // the old notes come first: this becomes the second choice
    open.setText('Відкрити іншу папку')
    go.focus()
  })
}

let app: App | undefined

ipcRenderer.on('app:before-close', async () => {
  try {
    await app?.flush()
    app?.workspace.trigger('quit')
  } finally {
    ipcRenderer.send('app:can-close')
  }
})

// the bundle is a classic script, no top-level await
void (async () => {
  const dir: string | null = (await ipcRenderer.invoke('vault:initial')) ?? localStorage.getItem(LAST_VAULT)
  if (dir && existsSync(dir) && statSync(dir).isDirectory()) {
    localStorage.setItem(LAST_VAULT, dir)
    app = new App(dir)
    app.onOpenVault = () => void pickVault()
    ;(window as unknown as { app: App }).app = app // Obsidian plugins and the dev console reach it as `app`
    await app.start(document.body)
  } else {
    welcome(dir ?? undefined)
  }
})()
