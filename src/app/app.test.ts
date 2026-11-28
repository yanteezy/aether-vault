// @vitest-environment jsdom
/** The whole page on a real temp vault: notes, saving, and a community plugin's full life cycle. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './app.js'
import { installDom } from './dom.js'
import type { MarkdownView } from './editor/markdownView.js'
import { trustVault } from './plugins/settings.js'
import { addTagToFile, moveTo, removeTag } from './views/fileActions.js'
import { fillTemplate, openDailyNote } from './corePlugins.js'
import moment from 'moment'

installDom(window)
// jsdom has no layout; CodeMirror measures text when it gets focus
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const PLUGIN = `
const { Plugin, PluginSettingTab, Setting } = require('obsidian')
const { EditorView } = require('@codemirror/view')
class Tab extends PluginSettingTab { display() { new Setting(this.containerEl).setName('Greeting') } }
module.exports = class Hello extends Plugin {
  async onload() {
    this.settings = Object.assign({ greeting: 'hi' }, await this.loadData())
    this.addCommand({ id: 'say', name: 'Say', callback: () => { this.said = true } })
    this.addRibbonIcon('dice', 'Hello', () => {})
    this.addStatusBarItem().setText('hello-status')
    this.registerEvent(this.app.vault.on('create', (f) => { this.created = f.path }))
    this.addSettingTab(new Tab(this.app, this))
    this.registerEditorExtension(EditorView.editorAttributes.of({ 'data-hello': '1' }))
    this.hasNode = typeof require('path').join === 'function'
    await this.saveData({ greeting: 'hello' })
  }
  onunload() { globalThis.__helloUnloaded = true }
}`

let dir: string
let app: App

async function start() {
  app = new App(dir)
  await app.start(document.body)
}
const until = async (check: () => boolean, ms = 3000) => {
  for (const t = Date.now(); !check(); ) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeEach(async () => {
  document.body.empty()
  document.head.empty()
  localStorage.clear()
  dir = await mkdtemp(join(tmpdir(), 'app-'))
  await writeFile(join(dir, 'Home.md'), '# Home\nSee [[Plan]] #start')
  const plugin = join(dir, '.aether', 'plugins', 'hello')
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'manifest.json'), JSON.stringify({ id: 'hello', name: 'Hello', version: '1.0.0' }))
  await writeFile(join(plugin, 'main.js'), PLUGIN)
  await writeFile(join(plugin, 'styles.css'), '.hello { color: red }')
})
afterEach(async () => {
  app?.vault.stopWatching()
  await app?.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('App', () => {
  it('shows files and tags, opens and saves a note, follows a link', async () => {
    await start()
    expect(document.querySelector('.nav-file-title')?.textContent).toBe('Home')
    expect(document.querySelector('.tag-pane-tag-text')?.textContent).toBe('#start')

    const home = app.vault.getFileByPath('Home.md')!
    await app.workspace.getLeaf(false).openFile(home)
    const view = app.workspace.getActiveMarkdownView() as MarkdownView
    expect(view.editor.getValue()).toBe('# Home\nSee [[Plan]] #start')
    expect(document.querySelector('.nav-file-title.is-active')).not.toBeNull()

    view.editor.replaceRange(' #more', { line: 1, ch: view.editor.getLine(1).length })
    await view.save()
    expect(await readFile(join(dir, 'Home.md'), 'utf8')).toBe('# Home\nSee [[Plan]] #start #more')
    expect(document.querySelector('.status-bar-item.mod-save')?.textContent).toBe('Збережено')

    await app.workspace.openLinkText('Plan', 'Home.md')
    expect(app.workspace.getActiveFile()?.path).toBe('Plan.md') // a link to nowhere creates the note
  })

  it('renders the reading view safely and runs plugin processors', async () => {
    await writeFile(join(dir, 'Read.md'), [
      '---', 'a: 1', '---',
      '# Title', 'Go to [[Home|home]] or [[Nowhere]] #tag', '',
      '<img src=x onerror="globalThis.__pwned = 1"><script>globalThis.__pwned = 2</script>', '',
      '```count', 'one two three', '```',
    ].join('\n'))
    await start()
    app.codeBlockProcessors.set('count', (src, el) => { el.setText(`words: ${src.trim().split(/\s+/).length}`) })
    app.markdownPostProcessors.add((el) => { el.querySelectorAll('h1').forEach((h) => h.addClass('pp-ran')) })

    await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Read.md')!)
    const view = app.workspace.getActiveMarkdownView()!
    await view.setMode('preview')
    const root = view.previewMode.containerEl
    expect(root.querySelector('h1.pp-ran')?.textContent).toBe('Title')
    expect(root.textContent).not.toContain('a: 1') // frontmatter is not body text
    expect(root.querySelector('a.internal-link[data-href=Home]')?.textContent).toBe('home')
    expect(root.querySelector('a.internal-link.is-unresolved')?.textContent).toBe('Nowhere')
    expect(root.querySelector('a.tag')?.textContent).toBe('#tag')
    expect(root.querySelector('.block-language-count')?.textContent).toBe('words: 3')
    expect(root.querySelector('script, [onerror]')).toBeNull()
    expect((globalThis as any).__pwned).toBeUndefined()

    ;(root.querySelector('a.internal-link[data-href=Home]') as HTMLElement).click()
    await until(() => app.workspace.getActiveFile()?.path === 'Home.md')
  })

  it('renames, moves and deletes from the file tree menu; links follow', async () => {
    await writeFile(join(dir, 'Links.md'), 'See [[Home]]')
    await mkdir(join(dir, 'Archive'))
    await start()
    const menuItem = (title: string) => [...document.querySelectorAll<HTMLElement>('.menu-item')].find((i) => i.textContent === title)!
    const item = (name: string) => [...document.querySelectorAll<HTMLElement>('.tree-item-self')].find((i) => i.textContent?.startsWith(name))!

    item('Home').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    menuItem('Перейменувати…').click()
    const input = document.querySelector<HTMLInputElement>('.aether-prompt-input')!
    // Enter in the field presses the form's first submit button: it must be the action, not «Скасувати»
    expect(input.form!.querySelector('button:not([type]), button[type=submit]')?.textContent).toBe('Перейменувати')
    input.value = 'bad/name'
    input.form!.requestSubmit()
    expect(document.querySelector('.aether-prompt-error')?.textContent).toContain('не може містити')
    input.value = 'Start'
    input.form!.requestSubmit()
    await until(() => !!app.vault.getFileByPath('Start.md'))
    // the links are rewritten after the file moves: wait for the text itself, not for the file to exist
    await until(() => readFileSync(join(dir, 'Links.md'), 'utf8') === 'See [[Start]]')

    await moveTo(app, app.vault.getFileByPath('Start.md')!, app.vault.getFolderByPath('Archive')!)
    expect(app.vault.getFileByPath('Archive/Start.md')).not.toBeNull()

    item('Links').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    menuItem('Видалити').click() // no question first: it goes at once, the toast can bring it back
    await until(() => !app.vault.getFileByPath('Links.md'))
    expect(await readFile(join(dir, '.trash', 'Links.md'), 'utf8')).toBe('See [[Start]]') // the name is unique, so the move needs no folder in the link
    const toast = document.querySelector<HTMLElement>('.undo-toast')!
    expect(toast.textContent).toContain('«Links» переміщено в кошик')
    toast.querySelector<HTMLButtonElement>('.undo-toast-undo')!.click()
    await until(() => !!app.vault.getFileByPath('Links.md'))
    expect(await readFile(join(dir, 'Links.md'), 'utf8')).toBe('See [[Start]]')
  })

  it('canvas: cards, edges and groups are saved as JSON Canvas', async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    canvas.addTextCard()
    const text = canvas.data.nodes[0] as { text: string }
    text.text = 'Idea'
    canvas.addFileCard(app.vault.getFileByPath('Home.md')!)
    const [a, b] = canvas.data.nodes
    canvas.connect(a, b)
    await canvas.save()
    const saved = JSON.parse(await readFile(join(dir, 'Полотно.canvas'), 'utf8'))
    expect(saved.nodes.map((n: { type: string }) => n.type)).toEqual(['text', 'file'])
    expect(saved.nodes[1].file).toBe('Home.md')
    expect(saved.nodes[1].x).toBeGreaterThanOrEqual(saved.nodes[0].x + saved.nodes[0].width) // placed beside, not on top
    expect(saved.edges).toMatchObject([{ fromNode: a.id, toNode: b.id }])
    expect(document.querySelectorAll('.workspace-tab-header')).toHaveLength(1) // the empty tab was reused

    // renaming the note moves the card's link with it; removing a card removes its edges
    await app.fileManager.renameFile(app.vault.getFileByPath('Home.md')!, 'Start.md')
    expect(canvas.data.nodes[1]).toMatchObject({ file: 'Start.md' })
    canvas.removeNodes([b.id])
    await canvas.save()
    expect(JSON.parse(await readFile(join(dir, 'Полотно.canvas'), 'utf8')).edges).toEqual([])
  })

  it('canvas: undo / redo, colours from the menu, strokes beside the file', async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    const canvasPath = join(dir, 'Полотно.canvas')
    const extraPath = join(dir, '.aether', 'canvas-extra', 'Полотно.canvas.json')
    const key = (code: string, mods: KeyboardEventInit = {}) =>
      document.querySelector('.canvas-wrapper')!.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), ctrlKey: true, bubbles: true, ...mods }))

    canvas.addTextCard()
    ;(document.activeElement as HTMLElement).blur() // leave the new card's editor
    key('KeyZ')
    expect(canvas.data.nodes).toEqual([])
    key('KeyZ', { shiftKey: true })
    expect(canvas.data.nodes).toHaveLength(1)
    key('KeyZ')
    key('KeyY')
    expect(canvas.data.nodes).toHaveLength(1)

    // colour from the card's right-click menu (Aether's 8 colours, stored as JSON Canvas colours)
    document.querySelector<HTMLElement>('.canvas-node')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    const green = document.querySelector<HTMLElement>('.note-menu [aria-label="Зелений"]')!
    expect(green.getAttribute('role')).toBe('radio')
    green.click()
    const card = document.querySelector<HTMLElement>('.canvas-node')!
    expect(card.style.getPropertyValue('--canvas-color')).toBe('var(--canvas-color-4)')
    await canvas.save()
    expect(JSON.parse(await readFile(canvasPath, 'utf8')).nodes[0].color).toBe('4')
    document.querySelector<HTMLElement>('.note-menu [aria-label="Без кольору"]')!.click()
    document.querySelector<HTMLElement>('.note-menu [aria-label="Зелений"]')!.click()
    const canvasText = await readFile(canvasPath, 'utf8')

    // strokes go to .aether/canvas-extra and never touch the .canvas file
    canvas.addStroke([[0, 0], [10, 5], [20, 0]])
    await canvas.save()
    expect(JSON.parse(await readFile(extraPath, 'utf8')).strokes).toMatchObject([{ points: [[0, 0], [10, 5], [20, 0]], width: 3 }])
    expect(document.querySelectorAll('.canvas-stroke')).toHaveLength(1)
    canvas.undo()
    await canvas.save()
    expect(JSON.parse(await readFile(extraPath, 'utf8')).strokes).toEqual([])
    canvas.undo() // the colour
    expect(canvas.data.nodes[0].color).toBeUndefined()
    canvas.redo()
    canvas.redo()
    await canvas.save()
    expect(await readFile(canvasPath, 'utf8')).toBe(canvasText)
    expect(JSON.parse(await readFile(extraPath, 'utf8')).strokes).toHaveLength(1)

    // a stroke is selected by a click and removed with Delete; the history has a cap
    document.querySelector('.canvas-stroke-hit')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    document.querySelector('.canvas-wrapper')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(canvas.strokes).toEqual([])
    for (let i = 0; i < 150; i++) canvas.addStroke([[i, 0], [i, 1]])
    for (let i = 0; i < 150; i++) canvas.undo()
    expect(canvas.strokes).toHaveLength(50)

    // reopened, the strokes come back from the extra file
    await canvas.save()
    await app.workspace.activeLeaf!.openFile(app.vault.getFileByPath('Home.md')!)
    await app.openMainCanvas()
    expect(app.activeCanvas()!.strokes).toHaveLength(50)
  })

  it('canvas: an extra file that does not parse is never overwritten', async () => {
    await mkdir(join(dir, '.aether', 'canvas-extra'), { recursive: true })
    const extraPath = join(dir, '.aether', 'canvas-extra', 'Полотно.canvas.json')
    await writeFile(extraPath, '{ "strokes": [')
    await start()
    await app.openMainCanvas()
    app.activeCanvas()!.addStroke([[0, 0], [5, 5]])
    await app.activeCanvas()!.save()
    expect(await readFile(extraPath, 'utf8')).toBe('{ "strokes": [')
  })

  it('backlinks, full-text search, graph', async () => {
    await writeFile(join(dir, 'Plan.md'), 'Back to [[Home]] soon\nunrelated line with a needle in it')
    await start()
    await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Home.md')!)
    expect(await app.toggleBacklinks()).toBe(true)
    await until(() => !!document.querySelector('.backlink-pane .search-result'))
    expect(document.querySelector('.backlink-pane .search-result-file-title')?.textContent).toBe('Plan')
    expect(document.querySelector('.backlink-pane .search-result-file-match')?.textContent).toBe('Back to [[Home]] soon')

    app.searchFor('needle')
    await until(() => !!document.querySelector('.nav-files-container mark'))
    expect(document.querySelector('.nav-files-container mark')?.textContent).toBe('needle')
    expect([...document.querySelectorAll('.nav-file-title')].map((e) => e.textContent)).toEqual(['Plan'])

    await app.openGraph()
    expect(document.querySelectorAll('.graph-node')).toHaveLength(2)
    await until(() => document.querySelectorAll('.graph-node').length === 2)
    expect(document.querySelector('.graph-links')?.getAttribute('d')?.match(/M/g)).toHaveLength(1) // one link
    expect(document.querySelector('.graph-svg')?.getAttribute('aria-label')).toBe("Граф: нотаток 2, зв'язків 1")
  })

  it('daily note from a template; template variables', async () => {
    await mkdir(join(dir, 'Шаблони'))
    await writeFile(join(dir, 'Шаблони', 'День.md'), '# {{title}}\nРік {{date:YYYY}}')
    await start()
    const opts = app.internalPlugins.getPluginById('daily-notes')!.instance.options as { folder: string; template: string }
    opts.folder = 'Журнал/2026'
    opts.template = 'Шаблони/День'
    const file = await openDailyNote(app, moment('2026-11-26'))
    expect(file.path).toBe('Журнал/2026/2026-11-26.md')
    expect(await readFile(join(dir, 'Журнал', '2026', '2026-11-26.md'), 'utf8')).toBe('# 2026-11-26\nРік 2026')
    expect(app.workspace.getActiveFile()).toBe(file)
    expect(fillTemplate('{{ time }}|{{title}}|{{DATE:DD.MM}}', 'T', moment('2026-01-02 09:05'))).toBe('09:05|T|02.01')
  })

  it('merges a change from another program into unsaved text; on a clash keeps both', async () => {
    await writeFile(join(dir, 'Home.md'), 'a\nb\nc')
    await start()
    await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Home.md')!)
    const view = app.workspace.getActiveMarkdownView()!
    view.editor.setLine(0, 'A (ours)')
    // another program edits a different line; the watcher would call syncPath
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(join(dir, 'Home.md'), 'a\nb\nc (theirs)')
    await app.vault.syncPath('Home.md')
    await until(() => view.editor.getValue() === 'A (ours)\nb\nc (theirs)')
    await view.save()
    expect(await readFile(join(dir, 'Home.md'), 'utf8')).toBe('A (ours)\nb\nc (theirs)')

    view.editor.setLine(1, 'B (ours)')
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(join(dir, 'Home.md'), 'A (ours)\nB (theirs)\nc (theirs)')
    await app.vault.syncPath('Home.md')
    await until(() => !!app.vault.getFileByPath('Home (зміни іншої програми).md'))
    expect(await readFile(join(dir, 'Home (зміни іншої програми).md'), 'utf8')).toBe('A (ours)\nB (theirs)\nc (theirs)')
    expect(view.editor.getValue()).toBe('A (ours)\nB (ours)\nc (theirs)')
    await view.save()
    expect(await readFile(join(dir, 'Home.md'), 'utf8')).toBe('A (ours)\nB (ours)\nc (theirs)')
  })

  it("canvas: Aether's card menu, pinned cards, shortcuts, Escape cancels a drag", async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    canvas.addTextCard()
    const n = canvas.data.nodes[0] as { text: string; x: number; y: number; id: string } & Record<string, unknown>
    n.text = 'Title\nfirst\nsecond'
    const el = () => document.querySelector<HTMLElement>('.canvas-node')!
    const menu = () => { el().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 })); return document.querySelector<HTMLElement>('.note-menu')! }

    // the menu leads with everyday actions and ends with «Видалити»; the looks are folded away until opened
    const titles = () => [...document.querySelectorAll<HTMLElement>('.note-menu__scroll > .note-menu__item')].map((b) => b.querySelector('.menu-item-title')!.textContent)
    const fold = menu().querySelector<HTMLButtonElement>('.note-menu__fold')!
    // a dialog, not role=menu: it holds fields, a slider and radio groups (WCAG 4.1.2)
    expect(document.querySelector('.note-menu')!.getAttribute('role')).toBe('dialog')
    expect(document.querySelector('.note-menu [role=menuitem], .note-menu [role=menuitemcheckbox]')).toBeNull()
    expect(titles().slice(0, 3)).toEqual(['Дублювати', 'Копіювати текст', 'Відкрити в «Нотатки»']) // editing is Enter / double click, not a menu row
    expect(titles().at(-1)).toBe('Видалити')
    expect(document.querySelector<HTMLElement>('.note-menu__look')!.hidden).toBe(true)
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    fold.click()
    expect(document.querySelector<HTMLElement>('.note-menu__look')!.hidden).toBe(false)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    // opened only for that menu: the next one starts compact again
    expect(menu().querySelector<HTMLElement>('.note-menu__look')!.hidden).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    // card type, title alignment, font and size are stored on the node and shown on the card
    menu().querySelector<HTMLElement>('.note-menu__style--bullets')!.click()
    expect(n['aether-style']).toBe('bullets')
    expect(el().hasClass('note-style-bullets')).toBe(true)
    expect(el().hasClass('title-align-center')).toBe(true) // titles are centred by default, nothing stored
    expect(n['aether-titleAlign']).toBeUndefined()
    document.querySelector<HTMLElement>('.note-menu [aria-label="Ліворуч"]')!.click()
    expect(n['aether-titleAlign']).toBe('left')
    expect(el().hasClass('title-align-left')).toBe(true)
    // text position: top by default, a banner sits in the middle; a choice is stored only when it differs
    expect(el().hasClass('v-align-top')).toBe(true)
    document.querySelector<HTMLElement>('.note-menu .note-menu__style--banner')!.click()
    expect(el().hasClass('v-align-middle')).toBe(true)
    expect(document.querySelector('.note-menu [aria-label="Посередині"]')!.getAttribute('aria-checked')).toBe('true')
    expect(n['aether-titleVAlign']).toBeUndefined()
    document.querySelector<HTMLElement>('.note-menu [aria-label="Знизу"]')!.click()
    expect(n['aether-titleVAlign']).toBe('bottom')
    expect(el().hasClass('v-align-bottom')).toBe(true)
    document.querySelector<HTMLElement>('.note-menu .note-menu__style--bullets')!.click()
    document.querySelector<HTMLElement>('.note-menu .font-tile[title="Моноширинний"]')!.click()
    expect(n['aether-font']).toBe('mono')
    expect(el().style.getPropertyValue('--nf')).toContain('monospace')
    document.querySelector<HTMLElement>('.note-menu .fs-control__stepper button[aria-label="Більше"]')!.click()
    expect(typeof n['aether-fontSize']).toBe('number')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector('.note-menu')).toBeNull() // a click outside closes it

    // pinned: the arrow keys do not move it
    ;[...menu().querySelectorAll<HTMLElement>('.note-menu__item')].find((b) => b.textContent === 'Закріпити позицію')!.click()
    expect(n['aether-locked']).toBe(true)
    const x0 = n.x
    el().focus()
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
    expect(n.x).toBe(x0)

    // Ctrl+D duplicates (unpinned copy), Ctrl+A selects all, Ctrl+C / paste adds another copy
    const key = (code: string, extra: KeyboardEventInit = {}) => el().dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), ctrlKey: true, bubbles: true, ...extra }))
    key('KeyD')
    expect(canvas.data.nodes).toHaveLength(2)
    expect(canvas.data.nodes[1]['aether-locked']).toBeUndefined()
    key('KeyA')
    key('KeyC')
    const paste = new Event('paste', { bubbles: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '' } })
    el().dispatchEvent(paste)
    expect(canvas.data.nodes).toHaveLength(4)

    // Escape during a drag puts the card back
    const free = document.querySelectorAll<HTMLElement>('.canvas-node')[1]
    const moved = canvas.data.nodes.find((x) => x.id === free.dataset.id)!
    const origin = { x: moved.x, y: moved.y }
    free.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10, pointerId: 1 }))
    document.querySelector('.canvas-wrapper')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 90, clientY: 70, pointerId: 1 }))
    expect(moved.x).not.toBe(origin.x)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect({ x: moved.x, y: moved.y }).toEqual(origin)
  })

  it('removes a tag from every note: text and frontmatter, never inside code', async () => {
    await writeFile(join(dir, 'A.md'), '---\ntags: [idea, keep]\n---\nText #idea and #keep\n`#idea in code`')
    await writeFile(join(dir, 'B.md'), 'Only #Idea here #idea/sub')
    await start()
    expect(await removeTag(app, '#idea')).toBe(2)
    expect(await readFile(join(dir, 'A.md'), 'utf8')).toBe('---\ntags:\n  - keep\n---\nText and #keep\n`#idea in code`')
    expect(await readFile(join(dir, 'B.md'), 'utf8')).toBe('Only here #idea/sub') // nested tags are other tags
    await until(() => !document.querySelector('.tag-pane-remove[aria-label*="#idea,"]'))
    expect(document.querySelector('.tag-pane-remove[aria-label="Прибрати тег #keep з усіх нотаток"]')).not.toBeNull()
  })

  it('hand-made tags stay in their vault; «Зберігати всюди» shows them in every vault', async () => {
    localStorage.removeItem('aether-global-tags')
    await start()
    const menuItem = (title: string) => [...document.querySelectorAll<HTMLElement>('.menu-item')].find((i) => i.textContent === title)!
    const pill = (tag: string) => document.querySelector<HTMLElement>(`.tag-pane-item[data-tag="${tag}"]`)
    // the empty sidebar has the root menu with «Новий тег…»
    app.workspace.leftSplitEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    menuItem('Новий тег…').click()
    const input = document.querySelector<HTMLInputElement>('.aether-prompt-input')!
    input.value = 'plan'
    input.form!.requestSubmit()
    await until(() => !!pill('#plan'))
    expect(JSON.parse(await readFile(join(dir, '.aether', 'tags.json'), 'utf8'))).toEqual({ tags: ['#plan'] })

    pill('#plan')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    menuItem('Зберігати всюди').click()
    await until(() => !!pill('#plan')?.classList.contains('is-global'))
    expect(JSON.parse(localStorage.getItem('aether-global-tags')!)).toEqual(['#plan'])

    // forgetting it removes it from both lists
    await app.tags.forget('#plan')
    await until(() => !pill('#plan'))
    expect(app.tags.globalTags()).toEqual([])
  })

  it('a menu closes on a press outside it, even where the canvas cancels mouse events', async () => {
    await start()
    app.workspace.leftSplitEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(document.querySelector('.menu')).not.toBeNull()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector('.menu')).toBeNull()
  })

  it('a tag dropped on a note goes to its frontmatter; on a text card it stays on the card; both show in the corner', async () => {
    await writeFile(join(dir, 'Idea.md'), '---\ntags: old\n---\nBody #inline')
    await start()
    const file = app.vault.getFileByPath('Idea.md')!
    expect(await addTagToFile(app, file, '#plan')).toBe(true)
    expect(await readFile(join(dir, 'Idea.md'), 'utf8')).toBe('---\ntags:\n  - old\n  - plan\n---\nBody #inline')
    await until(() => !!app.metadataCache.getFileCache(file)?.frontmatter?.tags?.includes('plan'))
    expect(await addTagToFile(app, file, '#INLINE')).toBe(false) // already there (case does not matter)

    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    canvas.addTextCard()
    document.querySelector<HTMLTextAreaElement>('.canvas-node-editor')!.blur()
    await canvas.addTag(canvas.data.nodes[0], '#plan')
    await canvas.addTag(canvas.data.nodes[0], '#Plan') // no duplicate
    expect((canvas.data.nodes[0] as unknown as Record<string, unknown>)['aether-tags']).toEqual(['#plan'])
    expect(document.querySelector('.canvas-node-tags')?.textContent).toBe('#plan')

    // the card menu removes it again: from the text card, and from a note card's file (text and frontmatter)
    const menuItem = (title: string) => [...document.querySelectorAll<HTMLElement>('.note-menu .menu-item')].find((i) => i.textContent?.startsWith(title))
    document.querySelector<HTMLElement>('.canvas-node')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
    menuItem('Прибрати тег #plan')!.click()
    expect((canvas.data.nodes[0] as unknown as Record<string, unknown>)['aether-tags']).toBeUndefined()
    expect(document.querySelector('.canvas-node-tags')).toBeNull()

    const fileCard = canvas.data.nodes.length
    canvas.addFileCard(file, { x: 600, y: 0 })
    const fileEl = () => document.querySelector<HTMLElement>(`.canvas-node[data-id="${canvas.data.nodes[fileCard].id}"]`)!
    await until(() => !!fileEl()?.querySelector('.canvas-node-tags'))
    expect(fileEl().querySelector('.canvas-node-tags')!.textContent).toBe('#old #plan') // #inline is in the text already
    fileEl().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
    menuItem('Прибрати тег #inline')!.click()
    // the menu still offers the inline tag (the corner just does not repeat it); removing it rewrites the file
    await until(() => !app.metadataCache.getFileCache(file)?.tags?.length)
    expect(await readFile(join(dir, 'Idea.md'), 'utf8')).toBe('---\ntags:\n  - old\n  - plan\n---\nBody')
  })

  it('canvas: a pasted image is saved to attachments under a free name and shown as an image card, never edited as text', async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const paste = (canvas as unknown as { pasteImages(f: File[]): Promise<void> }).pasteImages.bind(canvas)
    await paste([new File([png], 'image.png', { type: 'image/png' })])
    await paste([new File([png], 'image.png', { type: 'image/png' })])
    expect(canvas.data.nodes.map((n) => n.type === 'file' && n.file)).toEqual(['attachments/Вставлене фото.png', 'attachments/Вставлене фото 1.png'])
    expect([...await readFile(join(dir, 'attachments', 'Вставлене фото 1.png'))]).toEqual([...png])
    const img = document.querySelector<HTMLImageElement>('.canvas-node.is-image-file .canvas-node-img')!
    expect(img.alt).toBe('Вставлене фото')
    // double click on an image card must not open the picture as text
    await (canvas as unknown as { openOrEdit(n: unknown): Promise<void> }).openOrEdit(canvas.data.nodes[0])
    expect(document.querySelector('.canvas-node-editor')).toBeNull()
  })

  it('canvas: the mouse wheel eases the view to its target instead of jumping', async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    const w = document.querySelector<HTMLElement>('.canvas-wrapper')!
    const ty = () => (canvas as unknown as { t: { y: number } }).t.y
    const y0 = ty()
    for (let i = 0; i < 3; i++) w.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    expect(ty()).toBe(y0) // nothing jumps on the event itself
    await until(() => ty() !== y0, 15000)
    expect(ty()).toBeGreaterThan(y0 - 300) // on its way
    await until(() => ty() === y0 - 300, 15000) // and lands exactly on the target

    // a press stops a glide where it is
    w.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }))
    await until(() => ty() < y0 - 300, 15000)
    w.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }))
    const stopped = ty()
    await new Promise((r) => setTimeout(r, 120))
    expect(ty()).toBe(stopped)
  }, 40000) // animation frames in jsdom slow down a lot when the whole suite runs in parallel

  it('«Нотатки» goes to a note tab, never to another view (Galaxy, graph) or the canvas', async () => {
    await start()
    await app.openGraph() // any view that is not notes; the Galaxy needs WebGL, which jsdom lacks
    await app.openMainCanvas()
    await app.showNotes()
    expect(['markdown', 'empty']).toContain(app.workspace.activeLeaf?.view?.getViewType())
  })

  it('the vault name at the bottom asks before switching to another folder', async () => {
    await start()
    let picked = 0
    app.onOpenVault = () => { picked++ }
    const btn = document.querySelector<HTMLButtonElement>('.status-bar-item.mod-path')!
    expect(btn.tagName).toBe('BUTTON')
    btn.click()
    const card = document.querySelector<HTMLElement>('.vault-switch')!
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.textContent).toContain(app.vault.adapter.getBasePath())
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(btn)
    expect(picked).toBe(0) // closing never switches
    await new Promise((r) => setTimeout(r, 350))
    btn.click()
    document.querySelector<HTMLButtonElement>('.vault-switch-pick')!.click()
    expect(picked).toBe(1)
  })

  it('canvas: the same edge cannot be drawn twice, in either direction', async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    for (let i = 0; i < 2; i++) { canvas.addTextCard(); (document.activeElement as HTMLElement).blur() } // leave each new card's editor
    const [a, b] = canvas.data.nodes
    expect(canvas.connect(a, b, 'bottom', 'top')).toBe(true)
    expect(canvas.connect(a, b, 'bottom', 'top')).toBe(false)
    expect(canvas.connect(b, a, 'top', 'bottom')).toBe(false)
    expect(canvas.connect(a, b, 'right', 'left')).toBe(true) // other sides draw another path
    expect(canvas.data.edges).toHaveLength(2)

    // repeats saved earlier (or by another app) go with the command, and Ctrl+Z brings them back
    canvas.data.edges.push({ ...canvas.data.edges[0], id: 'dup1' }, { ...canvas.data.edges[0], id: 'dup2' })
    expect(app.commands.executeCommandById('canvas:remove-duplicate-edges')).toBe(true)
    expect(canvas.data.edges).toHaveLength(2)
    document.querySelector<HTMLElement>('.canvas-wrapper')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))
    expect(canvas.data.edges).toHaveLength(4)
  })

  it('canvas: Ctrl+click and Ctrl+drag select several cards; the menu acts on all of them', async () => {
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    for (let i = 0; i < 3; i++) canvas.addTextCard()
    document.querySelector<HTMLTextAreaElement>('.canvas-node-editor')!.blur() // finish editing the last new card
    canvas.select([])
    const els = () => [...document.querySelectorAll<HTMLElement>('.canvas-node')]
    const ctrlClick = (el: HTMLElement) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }))
    ctrlClick(els()[0])
    ctrlClick(els()[2])
    expect(canvas.selectedIds().sort()).toEqual([canvas.data.nodes[0].id, canvas.data.nodes[2].id].sort())
    ctrlClick(els()[0]) // again: out of the selection
    expect(canvas.selectedIds()).toEqual([canvas.data.nodes[2].id])

    // the menu of a selected card changes every selected card
    ctrlClick(els()[1])
    els()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
    expect(document.querySelector('.note-menu__title')?.textContent).toBe('Вибрано карток: 2')
    document.querySelector<HTMLElement>('.note-menu [aria-label="Синій"]')!.click()
    expect(canvas.data.nodes.map((n) => n.color)).toEqual([undefined, '5', '5'])

    // Ctrl+drag on the empty canvas: a box adds every card it touches
    const wrapper = document.querySelector<HTMLElement>('.canvas-wrapper')!
    canvas.select([])
    const a = canvas.data.nodes[0]
    // jsdom has no layout: the wrapper sits at 0,0 and the view is not moved, so screen = world + offset
    const toScreen = (x: number, y: number) => { const t = (canvas as unknown as { t: { x: number; y: number; zoom: number } }).t; return { x: x * t.zoom + t.x, y: y * t.zoom + t.y } }
    const p0 = toScreen(a.x - 5, a.y - 5)
    const p1 = toScreen(a.x + 5, a.y + 5)
    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true, clientX: p0.x, clientY: p0.y, pointerId: 2 }))
    wrapper.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p1.x, clientY: p1.y, pointerId: 2 }))
    wrapper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: p1.x, clientY: p1.y, pointerId: 2 }))
    expect(canvas.selectedIds()).toContain(a.id)
    expect(document.querySelector('.canvas-marquee')).toBeNull()
  })

  it('asks before running plugins of an untrusted vault', async () => {
    await writeFile(join(dir, '.aether', 'community-plugins.json'), '["hello"]')
    await start()
    expect(document.querySelector('.modal-title')?.textContent).toBe('Увімкнути плагіни спільноти?')
    expect(app.plugins.plugins.hello).toBeUndefined()
  })

  it('loads a plugin with the obsidian API and removes all of it when disabled', async () => {
    trustVault(dir)
    await start()
    expect(await app.plugins.enablePlugin('hello')).toBe(true)
    const plugin = app.plugins.plugins.hello as any

    expect(plugin.settings).toEqual({ greeting: 'hi' })
    expect(plugin.hasNode).toBe(true)
    expect(JSON.parse(await readFile(join(dir, '.aether/plugins/hello/data.json'), 'utf8'))).toEqual({ greeting: 'hello' })
    expect(JSON.parse(await readFile(join(dir, '.aether/community-plugins.json'), 'utf8'))).toEqual(['hello'])
    expect(app.commands.executeCommandById('hello:say')).toBe(true)
    expect(plugin.said).toBe(true)
    expect(document.querySelector('.aether-dock-plugins [aria-label=Hello]')).not.toBeNull()
    expect(document.querySelector('.plugin-hello')?.textContent).toBe('hello-status')
    expect(document.head.querySelector('style[data-plugin=hello]')?.textContent).toContain('.hello')
    expect(app.setting.pluginTabs).toHaveLength(1)

    await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Home.md')!)
    await until(() => !!document.querySelector('.cm-editor[data-hello]'))
    await app.vault.create('New.md', '')
    expect(plugin.created).toBe('New.md')

    await app.plugins.disablePlugin('hello')
    await app.vault.create('Other.md', '')
    expect(plugin.created).toBe('New.md') // its listener is gone
    expect((globalThis as any).__helloUnloaded).toBe(true)
    expect(app.commands.findCommand('hello:say')).toBeUndefined()
    expect(document.querySelector('.aether-dock-plugins')?.children).toHaveLength(0)
    expect(document.querySelector('.plugin-hello')).toBeNull()
    expect(document.head.querySelector('style[data-plugin=hello]')).toBeNull()
    expect(document.querySelector('.cm-editor[data-hello]')).toBeNull()
    expect(app.setting.pluginTabs).toHaveLength(0)
    expect(JSON.parse(await readFile(join(dir, '.aether/community-plugins.json'), 'utf8'))).toEqual([])
  })

  it('uses one name per thing: dock, palette, file tags, vault footer', async () => {
    await writeFile(join(dir, 'Board.canvas'), '{"nodes":[],"edges":[]}')
    await start()
    const dockAdd = () => document.querySelector('.aether-dock .aether-dock-button')!.getAttribute('aria-label')
    expect(dockAdd()).toBe('Нотатка')
    expect(document.querySelector<HTMLElement>('.aether-dock .aether-zoom')!.hidden).toBe(true) // canvas-only tools are hidden in notes view
    expect(document.querySelector<HTMLElement>('.aether-dock [aria-label="Рамка"]')!.hidden).toBe(true)
    expect(document.querySelector('.nav-file-tag')?.textContent).toBe('полотно')
    expect(document.querySelector('.status-bar-item.mod-path')?.textContent).toBe(app.vault.getName())
    await app.openMainCanvas()
    expect(dockAdd()).toBe('Картка')
    expect(document.querySelector<HTMLElement>('.aether-dock .aether-zoom')!.hidden).toBe(false)
    expect(app.commands.findCommand('canvas:add-text')?.name).toBe('Додати картку')
    expect(app.commands.findCommand('app:open-vault')?.name).toBe('Відкрити інше сховище…')
  })

  it('opens settings on «Загальне» (name, version, updates), with Claude under «Підключення» and community plugins last', async () => {
    await start()
    app.setting.open()
    const items = [...document.querySelectorAll('.vertical-tab-header > *')].map((e) => e.textContent)
    expect(document.querySelector('.vertical-tab-nav-item.is-active')?.textContent).toBe('Загальне')
    expect(items[0]).toBe('Застосунок')
    expect(items[items.indexOf('Підключення') + 1]).toBe('Claude')
    expect(items.at(-1)).toBe('Плагіни спільноти')
  })

  it('shows a start screen with a create button and recent notes instead of a bare empty tab', async () => {
    await start()
    expect(document.querySelector<HTMLElement>('.workspace-tab-header')!.classList.contains('is-empty-tab')).toBe(true)
    const btn = document.querySelector<HTMLButtonElement>('.empty-state-action')!
    expect(btn.textContent).toContain('Створити нотатку')
    expect([...document.querySelectorAll('.empty-state-recent-item')].map((b) => b.textContent)).toEqual(['Home'])
    document.querySelector<HTMLButtonElement>('.empty-state-recent-item')!.click()
    await until(() => app.workspace.getActiveFile()?.path === 'Home.md')
    expect(document.querySelector<HTMLElement>('.workspace-tab-header')!.classList.contains('is-empty-tab')).toBe(false)
  })

  it('uninstalls a plugin from settings: off, its folder in .trash, gone from the list', async () => {
    trustVault(dir)
    await start()
    expect(await app.plugins.enablePlugin('hello')).toBe(true)
    app.setting.open()
    ;[...document.querySelectorAll<HTMLButtonElement>('.vertical-tab-nav-item')].find((b) => b.textContent === 'Плагіни спільноти')!.click()
    const trash = () => document.querySelector<HTMLElement>('[aria-label="Видалити плагін Hello"]')
    trash()!.click()
    await until(() => !trash())
    expect(app.plugins.plugins.hello).toBeUndefined()
    expect(app.plugins.manifests.hello).toBeUndefined()
    expect(app.commands.findCommand('hello:say')).toBeUndefined()
    expect(JSON.parse(await readFile(join(dir, '.aether/community-plugins.json'), 'utf8'))).toEqual([])
    expect(JSON.parse(await readFile(join(dir, '.trash/hello/data.json'), 'utf8'))).toEqual({ greeting: 'hello' })
    await expect(readFile(join(dir, '.aether/plugins/hello/manifest.json'))).rejects.toThrow()

    // «Скасувати» in the toast: back from .trash, and on again
    document.querySelector<HTMLButtonElement>('.undo-toast-undo')!.click()
    await until(() => !!trash() && !!app.plugins.plugins.hello)
    expect(JSON.parse(await readFile(join(dir, '.aether/plugins/hello/data.json'), 'utf8'))).toEqual({ greeting: 'hello' })
    expect(JSON.parse(await readFile(join(dir, '.aether/community-plugins.json'), 'utf8'))).toEqual(['hello'])
  })

  it('undo toast: removing a tag from all notes comes back, but never over a note edited since', async () => {
    await writeFile(join(dir, 'A.md'), 'One #idea')
    await writeFile(join(dir, 'B.md'), 'Two #idea')
    await start()
    await until(() => !!document.querySelector('.tag-pane-item[data-tag="#idea"]'))
    const { removeTagWithUndo } = await import('./views/fileActions.js')
    await removeTagWithUndo(app, '#idea')
    expect(await readFile(join(dir, 'A.md'), 'utf8')).toBe('One')
    await app.vault.modify(app.vault.getFileByPath('B.md')!, 'Two, edited')
    // the ring's countdown shows the seconds left
    expect(document.querySelector('.undo-toast-count')?.textContent).toBe('10')
    document.querySelector<HTMLButtonElement>('.undo-toast-undo')!.click()
    await until(() => !document.querySelector('.undo-toast'))
    expect(await readFile(join(dir, 'A.md'), 'utf8')).toBe('One #idea')
    expect(await readFile(join(dir, 'B.md'), 'utf8')).toBe('Two, edited')
  })

  it('canvas: note card corner shows only frontmatter tags; the label hides when the heading repeats the name', async () => {
    await writeFile(join(dir, 'Same.md'), '---\ntags: [meta]\n---\n# same\nText #inline')
    await writeFile(join(dir, 'Other.md'), '# Different\nBody')
    await start()
    await app.openMainCanvas()
    const canvas = app.activeCanvas()!
    canvas.addFileCard(app.vault.getFileByPath('Same.md')!)
    canvas.addFileCard(app.vault.getFileByPath('Other.md')!)
    await until(() => document.querySelectorAll('.canvas-node-label').length === 2 && document.querySelectorAll('.canvas-node-content h1').length === 2)
    const [same, other] = [...document.querySelectorAll<HTMLElement>('.canvas-node-file')]
    expect(same.querySelector('.canvas-node-tags')?.textContent).toBe('#meta')
    expect(same.querySelector('.canvas-node-label')!.classList.contains('is-redundant')).toBe(true)
    expect(same.getAttribute('aria-label')).toBeTruthy()
    expect(other.querySelector('.canvas-node-label')!.classList.contains('is-redundant')).toBe(false)
  })
})
