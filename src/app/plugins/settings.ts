/**
 * Settings window (Ctrl/⌘+,) with Obsidian's layout: `.vertical-tab-header` list on the left,
 * the chosen tab's `containerEl` on the right. The first tab manages community plugins.
 */
import type { App } from '../app.js'
import type { PluginSettingTab } from '../component.js'
import { Modal, Notice, Setting } from '../ui.js'
import { undoToast } from '../undoToast.js'
import { fetchCatalog, installPlugin, searchCatalog, type CatalogEntry } from './catalog.js'

const TRUSTED_KEY = 'trusted-vaults'

export function isVaultTrusted(basePath: string) {
  try { return (JSON.parse(localStorage.getItem(TRUSTED_KEY) ?? '[]') as string[]).includes(basePath) } catch { return false }
}
export function trustVault(basePath: string) {
  const list = new Set<string>(JSON.parse(localStorage.getItem(TRUSTED_KEY) ?? '[]'))
  list.add(basePath)
  localStorage.setItem(TRUSTED_KEY, JSON.stringify([...list]))
}

/** Plugins run with full access to the computer, so the user must say yes once per vault. */
export class TrustModal extends Modal {
  constructor(app: App, private readonly onTrust: () => void) {
    super(app)
  }
  onOpen() {
    this.setTitle('Увімкнути плагіни спільноти?')
    this.contentEl.createEl('p', { text: 'У цьому сховищі є плагіни сторонніх авторів. Вони мають повний доступ до файлів і програм на комп\'ютері. Вмикайте їх, лише якщо довіряєте авторам.' })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Лишити вимкненими').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Довіряю, увімкнути').setCta().onClick(() => { this.close(); this.onTrust() }))
  }
}

/** Browse and install community plugins; installing does not enable them. */
class CatalogModal extends Modal {
  private list: CatalogEntry[] = []
  constructor(app: App, private readonly onInstalled: () => void) {
    super(app)
    this.modalEl.addClass('mod-catalog')
  }
  async onOpen() {
    this.setTitle('Каталог плагінів')
    const input = this.contentEl.createEl('input', { type: 'search', cls: 'aether-prompt-input', placeholder: 'Пошук за назвою, автором або описом', attr: { 'aria-label': 'Пошук у каталозі плагінів' } })
    const status = this.contentEl.createDiv({ cls: 'setting-item-description', attr: { role: 'status' }, text: 'Завантажую каталог…' })
    const results = this.contentEl.createDiv('catalog-results')
    try {
      this.list = await fetchCatalog()
      status.setText(`Плагінів у каталозі: ${this.list.length}`)
    } catch (e) {
      status.setText(`Не вдалося завантажити каталог: ${(e as Error).message}`)
      return
    }
    const render = () => {
      results.empty()
      for (const entry of searchCatalog(this.list, input.value)) {
        const installed = !!this.app.plugins.manifests[entry.id]
        new Setting(results)
          .setName(entry.name)
          .setDesc(`${entry.author} · ${entry.description}`)
          .addButton((b) => {
            b.setButtonText(installed ? 'Встановлено' : 'Встановити').setDisabled(installed)
            b.onClick(async () => {
              b.setDisabled(true).setButtonText('Встановлюю…')
              try {
                await installPlugin(this.app, entry)
                b.setButtonText('Встановлено')
                status.setText(`«${entry.name}» встановлено. Увімкніть його в списку плагінів.`)
                this.onInstalled()
              } catch (e) {
                b.setDisabled(false).setButtonText('Встановити')
                status.setText(`«${entry.name}» не встановлено: ${(e as Error).message}`)
              }
            })
          })
      }
    }
    input.addEventListener('input', render)
    render()
    input.focus()
  }
}

export class SettingsModal extends Modal {
  readonly pluginTabs: PluginSettingTab[] = []
  /** the app's own pages (daily notes, templates) */
  readonly coreTabs: PluginSettingTab[] = []
  private navEl!: HTMLElement
  private bodyEl!: HTMLElement
  private current: PluginSettingTab | 'community' = 'community'
  /** the first open lands on the first core tab («Вигляд»), later opens keep the last page */
  private opened = false

  constructor(app: App) {
    super(app)
    this.modalEl.addClass('mod-settings')
  }

  addTab(tab: PluginSettingTab) {
    this.pluginTabs.push(tab)
    if (this.containerEl.isConnected) this.renderNav()
  }
  removeTab(tab: PluginSettingTab) {
    const i = this.pluginTabs.indexOf(tab)
    if (i >= 0) this.pluginTabs.splice(i, 1)
    if (this.current === tab) this.current = 'community'
    if (this.containerEl.isConnected) this.renderNav(), this.renderBody()
  }

  openTabById(id: string) {
    this.current = this.pluginTabs.find((t) => t.plugin.manifest.id === id) ?? 'community'
    this.opened = true
    if (!this.containerEl.isConnected) this.open()
    else this.renderNav(), this.renderBody()
  }

  onOpen() {
    this.setTitle('Налаштування')
    this.contentEl.empty()
    if (!this.opened) {
      this.opened = true
      this.current = this.coreTabs[0] ?? this.current
    }
    const box = this.contentEl.createDiv('vertical-tabs-container')
    this.navEl = box.createEl('nav', { cls: 'vertical-tab-header', attr: { 'aria-label': 'Розділи налаштувань' } })
    this.bodyEl = box.createDiv('vertical-tab-content-container')
    this.renderNav()
    this.renderBody()
  }
  onClose() {
    if (this.current !== 'community') this.current.hide()
  }

  private renderNav() {
    this.navEl.empty()
    const item = (label: string, tab: PluginSettingTab | 'community') => {
      const b = this.navEl.createEl('button', { cls: 'vertical-tab-nav-item', text: label })
      b.toggleClass('is-active', this.current === tab)
      b.setAttr('aria-current', this.current === tab ? 'page' : null)
      b.addEventListener('click', () => {
        if (this.current !== 'community' && this.current !== tab) this.current.hide()
        this.current = tab
        this.renderNav()
        this.renderBody()
      })
    }
    this.navEl.createDiv({ cls: 'vertical-tab-header-group-title', text: 'Застосунок' })
    for (const tab of this.coreTabs.filter((t) => t.name !== 'Claude')) item(tab.name, tab)
    const claude = this.coreTabs.find((t) => t.name === 'Claude')
    if (claude) {
      this.navEl.createDiv({ cls: 'vertical-tab-header-group-title', text: 'Підключення' })
      item(claude.name, claude)
    }
    this.navEl.createDiv({ cls: 'vertical-tab-header-group-title', text: 'Плагіни' })
    for (const tab of this.pluginTabs) item(tab.name, tab)
    item('Плагіни спільноти', 'community')
  }

  private renderBody() {
    this.bodyEl.empty()
    if (this.current === 'community') return this.renderCommunity()
    this.bodyEl.appendChild(this.current.containerEl)
    this.current.containerEl.empty()
    try { this.current.display() } catch (e) { console.error(e); this.current.containerEl.setText('Помилка в налаштуваннях плагіна.') }
  }

  private renderCommunity() {
    const el = this.bodyEl.createDiv('vertical-tab-content')
    const pm = this.app.plugins
    const base = this.app.vault.adapter.getBasePath()
    el.createEl('h2', { text: 'Плагіни спільноти' })
    el.createEl('p', { cls: 'setting-item-description', text: 'Плагіни спільноти Obsidian додають нові можливості. Вони мають повний доступ до комп’ютера, тому встановлюйте їх лише від авторів, яким довіряєте.' })

    if (!isVaultTrusted(base)) {
      new Setting(el)
        .setName('Безпечний режим')
        .setDesc('Плагіни вимкнені. Вони мають повний доступ до комп\'ютера, тож вмикайте їх лише від авторів, яким довіряєте.')
        .addButton((b) => b.setButtonText('Увімкнути плагіни спільноти').setCta().onClick(async () => {
          trustVault(base)
          await pm.loadEnabled()
          this.renderBody()
        }))
      return
    }

    new Setting(el).setName('Каталог плагінів').setDesc('Плагіни спільноти Obsidian: пошук і встановлення.').addButton((b) => b.setButtonText('Огляд…').setCta().onClick(() => {
      new CatalogModal(this.app, () => this.renderBody()).open()
    }))
    new Setting(el).setName('Оновити список').setDesc('Перечитати папку плагінів.').addButton((b) => b.setButtonText('Оновити').onClick(async () => {
      await pm.loadManifests()
      this.renderBody()
    }))
    const manifests = Object.values(pm.manifests).sort((a, b) => a.name.localeCompare(b.name))
    if (!manifests.length) el.createDiv({ cls: 'pane-empty', text: 'Плагінів не знайдено.' })
    for (const m of manifests) {
      new Setting(el)
        .setName(`${m.name} ${m.version}`)
        .setDesc([m.author && `Автор: ${m.author}`, m.description].filter(Boolean).join(' · '))
        .addToggle((t) => t.setValue(!!pm.plugins[m.id]).onChange(async (on) => {
          if (on) t.setValue(await pm.enablePlugin(m.id))
          else await pm.disablePlugin(m.id)
          this.renderNav()
        }))
        .addExtraButton((b) => b.setIcon('trash-2').setTooltip(`Видалити плагін ${m.name}`).setClass('mod-warning').onClick(async () => {
          try {
            const r = await pm.uninstallPlugin(m.id)
            if (r) undoToast(`Плагін «${m.name}» видалено`, async () => {
              await pm.restorePlugin(r)
              if (this.containerEl.isConnected) { this.renderNav(); this.renderBody() }
            })
          } catch (e) {
            console.error(e)
            new Notice(`Не вдалося видалити плагін «${m.name}».`)
          }
          this.renderNav()
          this.renderBody()
        }))
    }
  }
}
