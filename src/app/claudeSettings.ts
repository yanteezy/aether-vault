/** Settings tab «Claude»: connect the read-only MCP server (see src/mcp) to Claude Desktop / Claude Code. */
import type { App } from './app.js'
import type { PluginSettingTab } from './component.js'
import { Setting } from './ui.js'

interface ClaudeInfo { mcpb: string | null; server: string }

const invoke = async <T>(channel: string): Promise<T> => {
  const { ipcRenderer } = await import('electron')
  return ipcRenderer.invoke(channel)
}

/** The command a user pastes into a terminal to add the server to Claude Code. */
export const claudeCodeCommand = (server: string, vault: string) => `claude mcp add aether -- node "${server}" "${vault}"`

export function claudeSettingsTab(app: App): PluginSettingTab {
  const containerEl = createDiv('vertical-tab-content')
  const display = () => {
    const el = containerEl
    el.empty()
    el.createEl('h2', { text: 'Claude' })
    el.createEl('p', {
      cls: 'claude-intro',
      text: 'Підключіть Claude, щоб він міг читати ваші нотатки й полотна: шукати, переказувати, відповідати на питання про вміст сховища.',
    })
    const promise = el.createEl('ul', { cls: 'claude-promise' })
    for (const line of [
      'Лише читання: Claude нічого не змінює і не видаляє.',
      'Усе працює на вашому комп’ютері. Нотатки нікуди не надсилаються, поки ви самі не запитаєте щось у Claude.',
      'Claude бачить, що відкрито зараз: вкладки, активну нотатку й виділені картки полотна.',
    ]) promise.createEl('li', { text: line })

    const vault = app.vault.adapter.getBasePath()
    let info: ClaudeInfo | null = null
    let infoError = ''
    const infoReady = invoke<ClaudeInfo>('claude:info').then((i) => { info = i }, () => { infoError = 'Не вдалося отримати дані про підключення. Перезапустіть застосунок.' })

    // Claude Desktop: one click
    el.createEl('h3', { text: 'Claude Desktop' })
    const say = (text: string, kind: '' | 'ok' | 'error' = '') => {
      status.className = `claude-status${kind ? ` is-${kind}` : ''}`
      status.setText(text)
    }
    const row = new Setting(el)
      .setName('Підключити одним кліком')
      .setDesc('Відкриється Claude Desktop із вікном встановлення. Там виберіть теку цього сховища.')
    row.addButton((b) => b.setButtonText('Підключити до Claude Desktop').setCta().onClick(async () => {
      b.setDisabled(true)
      say('Відкриваю Claude Desktop…')
      try {
        await infoReady
        if (infoError) throw new Error(infoError)
        if (info && !info.mcpb) {
          say('Одним кліком підключення працює в установленому застосунку. У робочій збірці скористайтеся командою для Claude Code нижче.', 'error')
          return
        }
        const err = await invoke<string>('claude:install')
        if (err) say(err, 'error')
        else say('Готово. У вікні Claude Desktop підтвердьте встановлення та виберіть теку сховища.', 'ok')
      } catch (e) {
        say(e instanceof Error && e.message ? e.message : 'Не вдалося підключити. Перевірте, чи встановлено Claude Desktop.', 'error')
      } finally {
        b.setDisabled(false)
      }
    }))

    const status = el.createDiv({ cls: 'claude-status', attr: { role: 'status', 'aria-live': 'polite' } })

    // Claude Code: copy a command
    el.createEl('h3', { text: 'Claude Code' })
    el.createEl('p', { cls: 'claude-hint', text: 'Вставте цю команду в термінал, щоб додати сховище до Claude Code.' })
    const box = el.createDiv('claude-cmd')
    const field = box.createEl('input', { cls: 'claude-cmd__field', attr: { type: 'text', readonly: '', 'aria-label': 'Команда для Claude Code', spellcheck: 'false' } })
    field.value = claudeCodeCommand('…', vault)
    infoReady.then(() => { field.value = claudeCodeCommand(info?.server ?? '…', vault) })
    field.addEventListener('focus', () => field.select())
    const copy = box.createEl('button', { cls: 'claude-cmd__copy', text: 'Копіювати', attr: { type: 'button' } })
    const copied = el.createDiv({ cls: 'claude-status', attr: { role: 'status', 'aria-live': 'polite' } })
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(field.value)
      } catch {
        field.focus(); field.select(); document.execCommand('copy')
      }
      copied.setText('Скопійовано')
      copied.className = 'claude-status is-ok'
      setTimeout(() => copied.empty(), 3000)
    })

    el.createEl('p', { cls: 'claude-path' }).append('Сховище: ', createEl('code', { text: vault }))
  }
  return { name: 'Claude', containerEl, display, hide: () => containerEl.empty() } as unknown as PluginSettingTab
}
