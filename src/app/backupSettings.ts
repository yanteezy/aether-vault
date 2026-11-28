/** Settings tab «Резервні копії»: pack the vault into one .zip — everything, or only notes and canvases. */
import type { App } from './app.js'
import type { PluginSettingTab } from './component.js'
import { Setting } from './ui.js'

type Mode = 'all' | 'notes'
interface Created { path: string; files: number; bytes: number }
interface Imported { path: string; files: number; meta: { vault: string; created: string } }

/** Error text from the main process, without Electron's «Error invoking remote method…» prefix. */
const why = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '')

const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const { ipcRenderer } = await import('electron')
  return ipcRenderer.invoke(channel, ...args)
}

/** «1 файл», «3 файли», «12 файлів». */
export const filesText = (n: number) => {
  const m10 = n % 10, m100 = n % 100
  return `${n} ${m10 === 1 && m100 !== 11 ? 'файл' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'файли' : 'файлів'}`
}
export const sizeText = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`)

const MODES: { id: Mode; title: string; desc: string }[] = [
  { id: 'all', title: 'Усе', desc: 'Нотатки, полотна, фото та інші вкладення, налаштування сховища.' },
  { id: 'notes', title: 'Лише нотатки', desc: 'Тільки нотатки й полотна, без фото та вкладень. Файл значно менший.' },
]

export function backupSettingsTab(app: App): PluginSettingTab {
  const containerEl = createDiv('vertical-tab-content')
  let mode: Mode = 'all'
  const display = () => {
    const el = containerEl
    el.empty()
    el.createEl('h2', { text: 'Резервні копії' })
    el.createEl('p', {
      cls: 'claude-intro',
      text: 'Збережіть копію сховища в один файл .aetherbackup — на інший диск, флешку чи в хмару. Такий файл відкриває лише Aether. Сховище при цьому не змінюється.',
    })

    const group = el.createDiv({ cls: 'backup-modes', attr: { role: 'radiogroup', 'aria-label': 'Що зберегти' } })
    for (const m of MODES) {
      const label = group.createEl('label', { cls: 'backup-mode' })
      const input = label.createEl('input', { attr: { type: 'radio', name: 'backup-mode', value: m.id } })
      input.checked = mode === m.id
      input.addEventListener('change', () => { if (input.checked) mode = m.id })
      const text = label.createDiv('backup-mode__text')
      text.createDiv({ cls: 'backup-mode__title', text: m.title })
      text.createDiv({ cls: 'backup-mode__desc', text: m.desc })
    }

    const status = createDiv({ cls: 'claude-status', attr: { role: 'status', 'aria-live': 'polite' } })
    const say = (msg: string, kind: '' | 'ok' | 'error' = '') => { status.className = `claude-status${kind ? ` is-${kind}` : ''}`; status.setText(msg) }
    let show: HTMLButtonElement | null = null
    new Setting(el)
      .setName('Створити резервну копію')
      .setDesc('Ви виберете, куди зберегти файл.')
      .addButton((b) => b.setButtonText('Створити копію…').setCta().onClick(async () => {
        b.setDisabled(true)
        show?.remove(); show = null
        say('Збираю файли…')
        try {
          const r = await invoke<Created | null>('backup:create', app.vault.adapter.getBasePath(), mode)
          if (!r) { say(''); return }
          say(`Копію збережено: ${filesText(r.files)}, ${sizeText(r.bytes)}.`, 'ok')
          show = createEl('button', { cls: 'backup-show', text: 'Показати у папці', attr: { type: 'button' } })
          status.after(show)
          show.addEventListener('click', () => void invoke('backup:show', r.path))
        } catch (e) {
          say(`Не вдалося створити копію. ${why(e)}`.trim(), 'error')
        } finally {
          b.setDisabled(false)
        }
      }))
    el.append(status)

    // import: a backup becomes a new vault in its own new folder; the open vault is not touched
    el.createEl('h3', { text: 'Імпорт' })
    const iStatus = createDiv({ cls: 'claude-status', attr: { role: 'status', 'aria-live': 'polite' } })
    const iSay = (msg: string, kind: '' | 'ok' | 'error' = '') => { iStatus.className = `claude-status${kind ? ` is-${kind}` : ''}`; iStatus.setText(msg) }
    let openBtn: HTMLButtonElement | null = null
    new Setting(el)
      .setName('Імпортувати сховище з копії')
      .setDesc('Оберіть файл .aetherbackup і папку: там з’явиться нове сховище. Поточне сховище не зміниться.')
      .addButton((b) => b.setButtonText('Імпортувати…').onClick(async () => {
        b.setDisabled(true)
        openBtn?.remove(); openBtn = null
        iSay('')
        try {
          const r = await invoke<Imported | null>('backup:import')
          if (!r) return
          iSay(`Сховище «${r.meta.vault}» відновлено: ${filesText(r.files)}, копія від ${new Date(r.meta.created).toLocaleDateString('uk')}.`, 'ok')
          openBtn = createEl('button', { cls: 'backup-show mod-cta', text: 'Відкрити це сховище', attr: { type: 'button' } })
          iStatus.after(openBtn)
          openBtn.addEventListener('click', async () => {
            if (!(await invoke<boolean>('vault:use', r.path))) return
            await app.flush?.()
            localStorage.setItem('last-vault', r.path)
            const { ipcRenderer } = await import('electron')
            ipcRenderer.send('app:reload')
          })
        } catch (e) {
          iSay(`Не вдалося імпортувати. ${why(e)}`.trim(), 'error')
        } finally {
          b.setDisabled(false)
        }
      }))
    el.append(iStatus)
  }
  return { name: 'Резервні копії', containerEl, display, hide: () => containerEl.empty() } as unknown as PluginSettingTab
}
