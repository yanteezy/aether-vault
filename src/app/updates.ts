/**
 * Updates in the page: Settings → «Загальне» (name, version, «Перевірити оновлення», notes from the old Aether)
 * and the glass notice in the corner when a new version is out. The main process does the work (src/main/updater.ts).
 */
import type { App } from './app.js'
import type { PluginSettingTab } from './component.js'
import { setIcon } from './icons.js'
import { Setting } from './ui.js'

export type UpdateState =
  | { state: 'idle' | 'checking' | 'none' | 'dev' }
  | { state: 'available'; version: string; notes?: string; manual: boolean }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
interface AppInfo { name: string; version: string; packaged: boolean; platform: string }
interface LegacyFound { vaults: number; notes: number; target: string }

// no main process (unit tests, a plain browser): everything here quietly does nothing
const ipc = async () => (await import('electron')).ipcRenderer as import('electron').IpcRenderer | undefined
const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T | undefined> => (await ipc())?.invoke(channel, ...args)
const listeners = new Set<(s: UpdateState) => void>()
let wired = false
async function onUpdate(cb: (s: UpdateState) => void) {
  listeners.add(cb)
  if (!wired) { wired = true; (await ipc())?.on('update:state', (_e, s: UpdateState) => { for (const l of listeners) l(s) }) }
  const now = await invoke<UpdateState>('update:state')
  if (now) cb(now)
  return () => listeners.delete(cb)
}

/** What the state means, in one line for the settings page. */
export function stateText(s: UpdateState, version: string): string {
  switch (s.state) {
    case 'dev': return 'Оновлення працюють у встановленому застосунку.'
    case 'checking': return 'Перевіряю…'
    case 'none': return `У вас найновіша версія (${version}).`
    case 'available': return `Доступна версія ${s.version}.`
    case 'downloading': return `Завантажую версію ${s.version}: ${s.percent}%`
    case 'ready': return `Версію ${s.version} завантажено. Перезапустіть Aether, щоб оновити.`
    case 'error': return 'Не вдалося перевірити оновлення. Перевірте з’єднання з інтернетом.'
    default: return ''
  }
}

/** Saves every open note, then restarts into the new version. */
async function restartToUpdate(app: App) {
  await app.flush()
  await invoke('update:install')
}

/** Ukrainian plural: «1 сховище», «3 сховища», «5 сховищ». */
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`
}
export const legacyText = (l: LegacyFound) => `${plural(l.vaults, 'сховище', 'сховища', 'сховищ')}, ${plural(l.notes, 'нотатка', 'нотатки', 'нотаток')}`

/** Copies the old Aether's notes into new vault folders and opens the first one. */
export async function moveLegacyAndOpen(flush?: () => Promise<void>) {
  const moved = await invoke<{ path: string }[] | null>('legacy:move')
  if (!moved?.length) return false
  await flush?.()
  localStorage.setItem('last-vault', moved[0].path)
  ;(await ipc())?.send('app:reload')
  return true
}

export function generalSettingsTab(app: App): PluginSettingTab {
  const containerEl = createDiv('vertical-tab-content')
  let off: (() => void) | undefined
  const display = async () => {
    const el = containerEl
    el.empty()
    const info = (await invoke<AppInfo>('app:info')) ?? { name: 'Aether', version: '—', packaged: false, platform: '' }
    const head = el.createDiv('about-app')
    const logo = head.createDiv({ cls: 'about-app__logo', attr: { 'aria-hidden': 'true' } })
    setIcon(logo, 'sparkles')
    const t = head.createDiv()
    t.createEl('h2', { cls: 'about-app__name', text: 'Aether' })
    t.createDiv({ cls: 'about-app__version', text: `Версія ${info.version}` })

    const status = createDiv({ cls: 'claude-status', attr: { role: 'status', 'aria-live': 'polite' } })
    let action: HTMLButtonElement | null = null
    new Setting(el)
      .setName('Оновлення')
      .setDesc('Aether сам перевіряє нові версії на GitHub після запуску й кожні 6 годин.')
      .addButton((b) => b.setButtonText('Перевірити оновлення').onClick(async () => {
        b.setDisabled(true)
        try { await invoke('update:check') } finally { b.setDisabled(false) }
      }))
    el.append(status)
    off?.()
    off = await onUpdate((s) => {
      status.className = `claude-status${s.state === 'none' || s.state === 'ready' ? ' is-ok' : s.state === 'error' ? ' is-error' : ''}`
      status.setText(stateText(s, info.version))
      action?.remove(); action = null
      if (s.state === 'available' || s.state === 'ready') {
        action = createEl('button', { cls: 'backup-show mod-cta', attr: { type: 'button' }, text: s.state === 'ready' ? 'Перезапустити й оновити' : s.manual ? 'Завантажити з GitHub' : 'Оновити' })
        action.addEventListener('click', () => void (s.state === 'ready' ? restartToUpdate(app) : invoke('update:download')))
        status.after(action)
      }
    })
    new Setting(el).setName('Що нового').setDesc('Список змін кожної версії.')
      .addButton((b) => b.setButtonText('Відкрити на GitHub').onClick(() => void invoke('update:releases')))

    const legacy = await invoke<LegacyFound | null>('legacy:find')
    if (legacy) {
      el.createEl('h3', { text: 'Старий Aether' })
      new Setting(el)
        .setName('Перенести нотатки зі старого Aether')
        .setDesc(`Знайдено ${legacyText(legacy)}. Їх буде скопійовано в нові папки в «${legacy.target}»; старі дані не зміняться.`)
        .addButton((b) => b.setButtonText('Перенести…').onClick(async () => {
          b.setDisabled(true)
          try { if (!(await moveLegacyAndOpen(() => app.flush()))) b.setDisabled(false) } catch { b.setDisabled(false) }
        }))
    }
  }
  return { name: 'Загальне', containerEl, display: () => void display(), hide: () => { off?.(); off = undefined; containerEl.empty() } } as unknown as PluginSettingTab
}

/**
 * The notice in the bottom-right corner: a new version is out → «Оновити» / «Пізніше»; then the download with
 * its progress; then «Перезапустити». «Пізніше» hides it for that version until the next start.
 */
export function installUpdateNotice(app: App) {
  let dismissed = ''
  const box = document.body.createDiv({ cls: 'update-notice', attr: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Оновлення Aether' } })
  box.hidden = true
  void onUpdate((s) => {
    if (s.state !== 'available' && s.state !== 'downloading' && s.state !== 'ready') {
      if (s.state === 'error' && !box.hidden) box.hidden = true // a failed download: the settings page says why
      return
    }
    if (s.version === dismissed && s.state === 'available') return
    box.empty()
    box.hidden = false
    const icon = box.createDiv({ cls: 'update-notice__icon', attr: { 'aria-hidden': 'true' } })
    setIcon(icon, s.state === 'ready' ? 'rotate-cw' : 'download')
    const text = box.createDiv('update-notice__text')
    text.createDiv({ cls: 'update-notice__title', text: s.state === 'ready' ? 'Оновлення готове' : `Доступна версія ${s.version}` })
    text.createDiv({
      cls: 'update-notice__desc',
      text: s.state === 'ready' ? 'Перезапустіть Aether — нотатки збережуться.' : s.state === 'downloading' ? `Завантажую… ${s.percent}%` : 'Нова версія Aether чекає на вас.',
    })
    if (s.state === 'downloading') {
      const bar = text.createDiv({ cls: 'update-notice__bar', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(s.percent), 'aria-label': 'Завантаження оновлення' } })
      bar.createDiv().style.width = `${s.percent}%`
      return
    }
    const actions = box.createDiv('update-notice__actions')
    const later = actions.createEl('button', { cls: 'update-notice__later', attr: { type: 'button' }, text: 'Пізніше' })
    later.addEventListener('click', () => { dismissed = s.version; box.hidden = true })
    const go = actions.createEl('button', { cls: 'update-notice__go', attr: { type: 'button' }, text: s.state === 'ready' ? 'Перезапустити' : s.manual ? 'Завантажити' : 'Оновити' })
    go.addEventListener('click', () => {
      if (s.state === 'ready') void restartToUpdate(app)
      else { void invoke('update:download'); if (s.manual) { dismissed = s.version; box.hidden = true } }
    })
  })
}
