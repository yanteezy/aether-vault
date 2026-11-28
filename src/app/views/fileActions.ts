/**
 * File and folder actions for the UI: the context menu, rename / move / delete dialogs.
 * Renames and moves go through FileManager, so links in other notes follow; deletes go to the vault's `.trash`.
 */
import { TFile, TFolder, type TAbstractFile } from '../../core/vault/files.js'
import { getAllTags } from '../../core/metadata/tags.js'
import type { App } from '../app.js'
import { Menu, Modal, Notice, Setting } from '../ui.js'
import { undoToast } from '../undoToast.js'
import { normalizeTag } from '../tagStore.js'

/** Characters that break file names or Obsidian links. */
const BAD_NAME = /[\\/:*?"<>|#^[\]]/

export function nameError(name: string): string | null {
  if (!name.trim()) return 'Назва не може бути порожньою.'
  if (BAD_NAME.test(name)) return 'Назва не може містити \\ / : * ? " < > | # ^ [ ].'
  if (name.startsWith('.')) return 'Назва не може починатися з крапки.'
  return null
}

class PromptModal extends Modal {
  private done = false
  constructor(app: App, private readonly title: string, private readonly initial: string, private readonly cta: string,
    private readonly validate: (v: string) => string | null, private readonly resolve: (v: string | null) => void) {
    super(app)
  }
  onOpen() {
    this.setTitle(this.title)
    const form = this.contentEl.createEl('form')
    const input = form.createEl('input', { type: 'text', cls: 'aether-prompt-input', attr: { 'aria-label': this.title } })
    input.value = this.initial
    const error = form.createDiv({ cls: 'aether-prompt-error', attr: { role: 'alert' } })
    const buttons = new Setting(form)
    buttons.addButton((b) => b.setButtonText('Скасувати').onClick(() => this.close()))
    buttons.addButton((b) => { b.setButtonText(this.cta).setCta(); b.buttonEl.type = 'submit' })
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const problem = this.validate(input.value.trim())
      error.setText(problem ?? '')
      input.setAttr('aria-invalid', !!problem)
      if (problem) return input.focus()
      this.done = true
      this.close()
      this.resolve(input.value.trim())
    })
    setTimeout(() => { input.focus(); input.select() })
  }
  onClose() { if (!this.done) this.resolve(null) }
}

export const promptText = (app: App, title: string, initial: string, cta: string, validate: (v: string) => string | null) =>
  new Promise<string | null>((resolve) => new PromptModal(app, title, initial, cta, validate, resolve).open())

class ConfirmModal extends Modal {
  private answered = false
  constructor(app: App, private readonly title: string, private readonly text: string, private readonly cta: string, private readonly resolve: (ok: boolean) => void) {
    super(app)
  }
  onOpen() {
    this.setTitle(this.title)
    this.contentEl.createEl('p', { text: this.text })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Скасувати').onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.cta).setWarning().onClick(() => { this.answered = true; this.close(); this.resolve(true) }))
  }
  onClose() { if (!this.answered) this.resolve(false) }
}

export const confirm = (app: App, title: string, text: string, cta: string) =>
  new Promise<boolean>((resolve) => new ConfirmModal(app, title, text, cta, resolve).open())

class FolderModal extends Modal {
  private chosen = false
  constructor(app: App, private readonly file: TAbstractFile, private readonly resolve: (f: TFolder | null) => void) {
    super(app)
  }
  onOpen() {
    this.setTitle(`Перемістити «${this.file.name}»`)
    const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder =>
      f instanceof TFolder && f !== this.file.parent && f !== this.file && !f.path.startsWith(`${this.file.path}/`))
    if (!folders.length) {
      this.contentEl.createEl('p', { text: 'Немає інших папок.' })
      return
    }
    let value = folders[0].path
    new Setting(this.contentEl).setName('Папка').addDropdown((d) => {
      for (const f of folders) d.addOption(f.path, f.isRoot() ? '/ (корінь сховища)' : f.path)
      d.onChange((v) => { value = v })
    })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Скасувати').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Перемістити').setCta().onClick(() => {
        this.chosen = true
        this.close()
        this.resolve(this.app.vault.getFolderByPath(value))
      }))
  }
  onClose() { if (!this.chosen) this.resolve(null) }
}

const childPath = (folder: TFolder, name: string) => (folder.isRoot() ? name : `${folder.path}/${name}`)

/** Moves `file` into `folder` through FileManager; refuses to overwrite. */
export async function moveTo(app: App, file: TAbstractFile, folder: TFolder) {
  const target = childPath(folder, file.name)
  if (target === file.path) return
  if (app.vault.getAbstractFileByPath(target)) return void new Notice(`У папці «${folder.name || '/'}» вже є «${file.name}».`)
  await app.fileManager.renameFile(file, target)
  new Notice(`«${file.name}» переміщено.`)
}

export async function renameWithPrompt(app: App, file: TAbstractFile) {
  const isNote = file instanceof TFile && file.extension === 'md'
  const current = file instanceof TFile ? (isNote ? file.basename : file.name) : file.name
  const name = await promptText(app, 'Перейменувати', current, 'Перейменувати', (v) => {
    const problem = nameError(v)
    if (problem) return problem
    const path = childPath(file.parent!, isNote ? `${v}.md` : v)
    return path !== file.path && app.vault.getAbstractFileByPath(path) ? 'Файл із такою назвою вже є.' : null
  })
  if (!name || name === current) return
  await app.fileManager.renameFile(file, childPath(file.parent!, isNote ? `${name}.md` : name))
}

/** Moves to the vault's `.trash` at once; the toast's «Скасувати» puts it back. */
export async function trashWithUndo(app: App, file: TAbstractFile) {
  const { path } = file
  const name = file instanceof TFile ? file.basename : file.name
  await app.flush()
  const trashed = await app.fileManager.trashFile(file)
  undoToast(file instanceof TFolder ? `Папку «${name}» переміщено в кошик` : `«${name}» переміщено в кошик`, async () => {
    if (!(await app.vault.restoreFromTrash(trashed, path))) throw new Error(`на місці «${path}» вже є інший файл`)
  })
}

export async function newFolderWithPrompt(app: App, parent: TFolder) {
  const name = await promptText(app, 'Нова папка', 'Нова папка', 'Створити', (v) =>
    nameError(v) ?? (app.vault.getAbstractFileByPath(childPath(parent, v)) ? 'Така папка вже є.' : null))
  if (name) await app.vault.createFolder(childPath(parent, name))
}

/** Takes `tag` (with #) out of every note: from the text (not code: the cache knows where tags are) and from frontmatter. */
/** Texts before / after `removeTag` changed them, by path: what its undo writes back. */
export type TextUndo = Map<string, { before: string; after: string }>

/** `undo`: collects each changed note's text so `restoreTexts` can take the change back. */
export async function removeTag(app: App, tag: string, files?: TFile[], undo?: TextUndo) {
  await app.flush() // open editors write first, so their text is what we edit
  await app.metadataCache.idle()
  const want = tag.toLowerCase()
  const bare = want.replace(/^#/, '')
  let changed = 0
  for (const file of files ?? app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file)
    const spots = (cache?.tags ?? []).filter((t) => t.tag.toLowerCase() === want)
    const fmTags = cache?.frontmatter && ['tags', 'tag'].some((k) => {
      const v = cache.frontmatter![k]
      const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []
      return list.some((x) => String(x).replace(/^#/, '').toLowerCase() === bare)
    })
    if (!spots.length && !fmTags) continue
    const before = undo && await app.vault.read(file)
    if (spots.length) {
      await app.vault.process(file, (text) => {
        for (const t of [...spots].sort((a, b) => b.position.start.offset - a.position.start.offset)) {
          const { start, end } = t.position
          if (text.slice(start.offset, end.offset).toLowerCase() !== want) continue // the file changed meanwhile
          const from = start.offset > 0 && text[start.offset - 1] === ' ' ? start.offset - 1 : start.offset
          text = text.slice(0, from) + text.slice(end.offset)
        }
        return text
      })
    }
    if (fmTags) {
      await app.fileManager.processFrontMatter(file, (fm) => {
        for (const k of ['tags', 'tag']) {
          const v = fm[k]
          if (v === undefined) continue
          const list = (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).filter((x) => x !== '' && String(x).replace(/^#/, '').toLowerCase() !== bare)
          if (list.length) fm[k] = Array.isArray(v) ? list : list.join(', ')
          else delete fm[k]
        }
      })
    }
    if (undo) undo.set(file.path, { before: before!, after: await app.vault.read(file) })
    changed++
  }
  return changed
}

/** Writes back the texts `removeTag` saved — but never over a note that was edited since. */
export async function restoreTexts(app: App, undo: TextUndo) {
  let skipped = 0
  for (const [path, { before, after }] of undo) {
    const file = app.vault.getFileByPath(path)
    if (!file || (await app.vault.read(file)) !== after) { skipped++; continue }
    await app.vault.modify(file, before)
  }
  if (skipped) new Notice(`Не повернуто нотаток, змінених після видалення: ${skipped}.`, 0)
}

/** What a tag pill carries while it is dragged onto a note. */
export const TAG_MIME = 'text/x-aether-tag'

/** Adds `#tag` to a note's frontmatter `tags` (no-op when the note already has it). */
export async function addTagToFile(app: App, file: TFile, tag: string) {
  const name = tag.replace(/^#/, '')
  const cache = app.metadataCache.getFileCache(file)
  if (cache && getAllTags(cache).some((t) => t.toLowerCase() === tag.toLowerCase())) return false
  await app.fileManager.processFrontMatter(file, (fm) => {
    const list = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? fm.tags.split(/[,\s]+/).filter(Boolean) : []
    fm.tags = [...list, name]
  })
  return true
}

/** Takes the tag out of every note (and the hand-made lists) at once; the toast's «Скасувати» puts it all back. */
export async function removeTagWithUndo(app: App, tag: string) {
  const texts: TextUndo = new Map()
  const changed = await removeTag(app, tag, undefined, texts)
  const lists = await app.tags.forget(tag)
  undoToast(changed ? `Тег ${tag} прибрано з нотаток: ${changed}` : `Тег ${tag} прибрано`, async () => {
    await restoreTexts(app, texts)
    await app.tags.restore(tag, lists)
  })
}

/** A tag pill's menu: show its notes, keep it everywhere (in every vault) or only here, remove it. */
export function tagMenu(app: App, tag: string, count: number): Menu {
  const everywhere = app.tags.isGlobal(tag)
  return new Menu()
    .addItem((i) => i.setTitle('Показати нотатки з тегом').setIcon('search').onClick(() => app.searchFor(tag)))
    .addItem((i) => i.setTitle('Зберігати всюди').setIcon('globe').setChecked(everywhere).onClick(() => void app.tags.setGlobal(tag, !everywhere)))
    .addSeparator()
    .addItem((i) => i.setTitle(count ? 'Прибрати тег…' : 'Прибрати тег').setIcon('trash-2').setWarning(true)
      .onClick(() => void removeTagWithUndo(app, tag)))
}

export async function newTagWithPrompt(app: App) {
  const value = await promptText(app, 'Новий тег', '', 'Створити', (v) =>
    normalizeTag(v) ? null : 'Тег — одне слово з літер, цифр, _ / - (не лише цифри), без пробілів.')
  if (!value) return
  await app.tags.add(normalizeTag(value)!)
  new Notice(`Тег ${normalizeTag(value)} додано в це сховище.`)
}

/** The menu for a file, folder or the empty tree; plugins add items through the `file-menu` event. */
export function fileMenu(app: App, file: TAbstractFile): Menu {
  const menu = new Menu()
  const folder = file instanceof TFolder ? file : null
  if (folder) {
    menu.addItem((i) => i.setTitle('Нова нотатка').setIcon('file-plus').onClick(() => void app.newNote(folder)))
    menu.addItem((i) => i.setTitle('Нова папка…').setIcon('folder-plus').onClick(() => void newFolderWithPrompt(app, folder)))
    menu.addItem((i) => i.setTitle('Нове полотно').setIcon('layout-dashboard').onClick(() => void app.newCanvas(folder)))
    if (folder.isRoot()) {
      menu.addItem((i) => i.setTitle('Новий тег…').setIcon('tag').onClick(() => void newTagWithPrompt(app)))
      menu.addSeparator()
      menu.addItem((i) => i.setTitle('Відкрити інше сховище…').setIcon('folder-open').onClick(() => app.onOpenVault()))
    }
  } else if (file instanceof TFile && file.extension === 'md') {
    menu.addItem((i) => i.setTitle('Відкрити в новій вкладці').setIcon('file-plus').onClick(() => void app.workspace.getLeaf(true).openFile(file)))
  }
  if (!folder?.isRoot()) {
    menu.addSeparator()
    menu.addItem((i) => i.setTitle('Перейменувати…').setIcon('pencil').onClick(() => void renameWithPrompt(app, file)))
    menu.addItem((i) => i.setTitle('Перемістити до…').setIcon('folder-input').onClick(() => {
      new FolderModal(app, file, (to) => { if (to) void moveTo(app, file, to) }).open()
    }))
    menu.addSeparator()
    menu.addItem((i) => i.setTitle('Видалити').setIcon('trash-2').setWarning(true).onClick(() => void trashWithUndo(app, file)))
  }
  app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', app.workspace.getLeavesOfType('file-explorer')[0])
  return menu
}
