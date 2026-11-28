/**
 * The two core plugins community plugins rely on most: daily notes and templates.
 * Options live where Obsidian keeps them (`<configDir>/daily-notes.json`, `templates.json`) and are reachable as
 * `app.internalPlugins.getPluginById('daily-notes').instance.options`, which Calendar and others read.
 */
import moment from 'moment'
import { normalizePath, TFile } from '../core/vault/files.js'
import type { App } from './app.js'
import type { PluginSettingTab } from './component.js'
import type { Editor } from './editor/editor.js'
import { Modal, Notice, Setting } from './ui.js'
import { claudeSettingsTab } from './claudeSettings.js'
import { backupSettingsTab } from './backupSettings.js'
import { generalSettingsTab } from './updates.js'
import { fontSizeControl, fontTiles, loadAppearance, saveAppearance } from './appearance.js'

export interface DailyNotesOptions { folder: string; format: string; template: string }
export interface TemplatesOptions { folder: string; dateFormat: string; timeFormat: string }
export interface CorePlugin<T> { enabled: boolean; instance: { options: T } }

const DEFAULTS = {
  'daily-notes': { folder: '', format: 'YYYY-MM-DD', template: '' } as DailyNotesOptions,
  templates: { folder: 'Шаблони', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' } as TemplatesOptions,
}
type Id = keyof typeof DEFAULTS

/** `{{title}}`, `{{date}}`, `{{time}}` and `{{date:FORMAT}}` / `{{time:FORMAT}}`, as Obsidian fills them. */
export function fillTemplate(text: string, title: string, now = moment(), dateFormat = 'YYYY-MM-DD', timeFormat = 'HH:mm') {
  return text.replace(/{{\s*(date|time|title)\s*(?::([^}]*))?}}/gi, (_, kind: string, fmt?: string) => {
    const k = kind.toLowerCase()
    if (k === 'title') return title
    return now.format(fmt?.trim() || (k === 'date' ? dateFormat : timeFormat))
  })
}

const optionsPath = (app: App, id: Id) => `${app.vault.configDir}/${id}.json`
export const options = <K extends Id>(app: App, id: K) => (app.internalPlugins.plugins[id] as CorePlugin<(typeof DEFAULTS)[K]>).instance.options

/** Reads saved options (a missing or broken file means defaults) and registers both core plugins. */
export async function loadCorePlugins(app: App) {
  for (const id of Object.keys(DEFAULTS) as Id[]) {
    let saved = {}
    try { saved = JSON.parse(await app.vault.adapter.read(optionsPath(app, id))) } catch { /* defaults */ }
    app.internalPlugins.plugins[id] = { enabled: true, instance: { options: { ...DEFAULTS[id], ...saved } } }
  }
}

async function saveOptions(app: App, id: Id) {
  await app.vault.adapter.mkdir(app.vault.configDir)
  await app.vault.adapter.write(optionsPath(app, id), JSON.stringify(options(app, id), null, 2))
}

/** Creates every missing folder on the way to `path`'s parent. */
async function ensureFolder(app: App, path: string) {
  const parts = path.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/')
    if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p)
  }
}

async function templateText(app: App, template: string) {
  if (!template.trim()) return ''
  const file = app.metadataCache.getFirstLinkpathDest(normalizePath(template), '')
  if (!file) {
    new Notice(`Шаблон «${template}» не знайдено.`)
    return ''
  }
  return app.vault.cachedRead(file)
}

/** Opens the note for `date` (today by default), making it from the template if it does not exist. */
export async function openDailyNote(app: App, date = moment()) {
  const o = options(app, 'daily-notes')
  const name = date.format(o.format || DEFAULTS['daily-notes'].format)
  const path = normalizePath(o.folder ? `${o.folder}/${name}.md` : `${name}.md`)
  let file = app.vault.getFileByPath(path)
  if (!file) {
    await ensureFolder(app, path)
    const t = options(app, 'templates')
    file = await app.vault.create(path, fillTemplate(await templateText(app, o.template), name, date, t.dateFormat, t.timeFormat))
  }
  await app.workspace.getLeaf(false).openFile(file)
  return file
}

class TemplateModal extends Modal {
  constructor(app: App, private readonly editor: Editor, private readonly title: string) {
    super(app)
  }
  onOpen() {
    this.setTitle('Вставити шаблон')
    const folder = normalizePath(options(this.app, 'templates').folder)
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${folder}/`)).sort((a, b) => a.path.localeCompare(b.path))
    if (!files.length) {
      this.contentEl.createEl('p', { text: `У теці «${folder}» ще немає шаблонів. Теку можна змінити в налаштуваннях.` })
      return
    }
    let path = files[0].path
    new Setting(this.contentEl).setName('Шаблон').addDropdown((d) => {
      for (const f of files) d.addOption(f.path, f.basename)
      d.onChange((v) => { path = v })
    })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Скасувати').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Вставити').setCta().onClick(async () => {
        this.close()
        const file = this.app.vault.getFileByPath(path)
        if (!(file instanceof TFile)) return
        const t = options(this.app, 'templates')
        this.editor.replaceSelection(fillTemplate(await this.app.vault.cachedRead(file), this.title, moment(), t.dateFormat, t.timeFormat))
        this.editor.focus()
      }))
  }
}

export function insertTemplate(app: App, editor: Editor, title: string) {
  new TemplateModal(app, editor, title).open()
}

/** Settings pages for the two core plugins, shaped like plugin setting tabs. */
export function coreSettingTabs(app: App): PluginSettingTab[] {
  const tab = (name: string, display: (el: HTMLElement) => void) => {
    const containerEl = createDiv('vertical-tab-content')
    return { name, containerEl, display: () => display(containerEl), hide: () => containerEl.empty() } as unknown as PluginSettingTab
  }
  const text = (el: HTMLElement, id: Id, key: string, label: string, desc: string) =>
    new Setting(el).setName(label).setDesc(desc).addText((t) => t
      .setValue(String((options(app, id) as unknown as Record<string, string>)[key]))
      .onChange(async (v) => { (options(app, id) as unknown as Record<string, string>)[key] = v.trim(); await saveOptions(app, id) }))
  return [
    generalSettingsTab(app),
    tab('Вигляд', (el) => {
      el.createEl('h2', { text: 'Вигляд' })
      new Setting(el)
        .setName('Зменшити прозорість')
        .setDesc('Скляні панелі стають суцільними, без розмиття. Легше читати й менше навантаження на відеокарту.')
        .addToggle((t) => t.setValue(document.body.hasClass('reduce-transparency')).onChange((on) => {
          document.body.toggleClass('reduce-transparency', on)
          localStorage.setItem('reduce-transparency', on ? '1' : '')
        }))
      // Aether's note fonts and text size: cards, the editor and the reading view
      const a = loadAppearance()
      new Setting(el).setName('Авторозмір тексту').setDesc('Текст змінюється лише разом із розміром нотатки')
        .addToggle((t) => t.setValue(a.autoTextSize).onChange((on) => saveAppearance({ autoTextSize: on })))
      const fonts = new Setting(el).setName('Шрифт нотаток')
      fonts.settingEl.addClass('setting-item--stack')
      fontTiles(fonts.controlEl, a.noteFont, (v) => saveAppearance({ noteFont: v ?? 'auto' }))
      const size = new Setting(el).setName('Розмір тексту карток').setDesc('Перетягніть повзунок або введіть число')
      fontSizeControl(size.controlEl, a.cardFontSize, a.cardFontSize, (v) => { if (typeof v === 'number') saveAppearance({ cardFontSize: v }) })
    }),
    tab('Щоденні нотатки', (el) => {
      el.createEl('h2', { text: 'Щоденні нотатки' })
      text(el, 'daily-notes', 'folder', 'Тека', 'Куди класти щоденні нотатки. Порожньо — корінь сховища.')
      text(el, 'daily-notes', 'format', 'Формат назви', 'Формат дати moment.js, наприклад YYYY-MM-DD.')
      text(el, 'daily-notes', 'template', 'Шаблон', 'Шлях до нотатки-шаблону, наприклад Шаблони/День.')
    }),
    tab('Шаблони', (el) => {
      el.createEl('h2', { text: 'Шаблони' })
      text(el, 'templates', 'folder', 'Тека шаблонів', 'Нотатки з цієї теки пропонує команда «Вставити шаблон».')
      text(el, 'templates', 'dateFormat', 'Формат {{date}}', 'Формат дати moment.js.')
      text(el, 'templates', 'timeFormat', 'Формат {{time}}', 'Формат часу moment.js.')
    }),
    backupSettingsTab(app),
    claudeSettingsTab(app),
  ]
}
