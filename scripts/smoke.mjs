// Starts the real Electron app on a temp vault, types into a note, checks the file on disk
// (also after closing the window right away) and saves a screenshot.
// Usage: npm run smoke [-- <screenshot.png>]
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'

const shot = process.argv[2] ?? join(tmpdir(), 'aether-smoke.png')
const root = await mkdtemp(join(tmpdir(), 'aether-smoke-'))
const vault = join(root, 'Мої нотатки')
await mkdir(join(vault, 'Проєкти'), { recursive: true })
const note = join(vault, 'Ласкаво просимо.md')
await writeFile(note, '# Ласкаво просимо\n\nЦе **Aether** — нотатки на звичайних файлах. Перегляньте [[План запуску]] і #ідеї.\n\n> Один запис — багато видів.\n\n- [ ] Спробувати полотно\n- Тег #робота\n')
await writeFile(join(vault, 'Проєкти', 'План запуску.md'), '---\ntags: [робота]\n---\n## Кроки\n1. Ядро\n2. Плагіни\n')
await writeFile(join(vault, 'Ідеї.md'), 'Список ідей #ідеї')

const app = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'user-data')}`, '--display=2'] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.waitForSelector('.nav-file-title')
await page.getByRole('treeitem', { name: 'Ласкаво просимо' }).click()
await page.waitForSelector('.cm-content')
await page.click('.cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('Додано у smoke-тесті.')
await page.waitForTimeout(900)
assert.match(await readFile(note, 'utf8'), /Додано у smoke-тесті\.$/)
// reading view: Ctrl+E shows the rendered note, a click on a wiki link opens it
await page.keyboard.press('Control+e')
await page.waitForSelector('.markdown-preview-view h1')
await page.screenshot({ path: shot })
await page.click('.markdown-preview-view a.internal-link')
await page.waitForFunction(() => app.workspace.getActiveFile()?.path === 'Проєкти/План запуску.md')
await page.getByRole('treeitem', { name: 'Ласкаво просимо' }).click()
await page.keyboard.press('Control+e')
await page.click('.cm-content')
await page.keyboard.press('Control+End')

// requestUrl() from a plugin goes through the main process
const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const got = await page.evaluate((url) => app.plugins.requireFor('obsidian').requestUrl(url).json, `http://127.0.0.1:${server.address().port}/`)
server.close()
assert.deepEqual(got, { ok: true })

// type and close at once: the window must write the note before it goes away
await page.keyboard.type(' Остання фраза.')
await app.close()
assert.match(await readFile(note, 'utf8'), /Остання фраза\.$/)

// next start: the same tab comes back; a change from another program shows up in the editor
const again = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'user-data')}`, '--display=2'] })
const page2 = await again.firstWindow()
page2.on('pageerror', (e) => errors.push(e.message))
await page2.waitForSelector('.cm-content')
assert.equal(await page2.textContent('.workspace-tab-header.is-active .workspace-tab-header-inner-title'), 'Ласкаво просимо')
await writeFile(note, '# Змінено іншою програмою\n')
await page2.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Змінено іншою програмою'))

// switching the vault from the sidebar really opens the other folder (the page reload goes through the main process)
const other = join(root, 'Інше сховище')
await mkdir(other)
await writeFile(join(other, 'Звідти.md'), 'Нотатка з іншої папки')
await again.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, other)
await page2.click('.status-bar-item.mod-path')
await page2.click('.vault-switch-pick', { noWaitAfter: true })
await page2.waitForSelector('.nav-file-title[data-path="Звідти.md"]', { timeout: 15000 })
assert.equal(await page2.textContent('.status-bar-item.mod-path'), 'Інше сховище')

// «Галактика»: the graph comes from the worker, WebGL2 draws it, the dock is there
await page2.getByRole('button', { name: 'Галактика', exact: true }).click()
await page2.waitForFunction(() => { const v = app.workspace.getLeavesOfType('galaxy')[0]?.view; return v?.data?.count === 1 && !document.querySelector('.galaxy-status') }, null, { timeout: 15000 })
assert.equal(await page2.evaluate(() => app.workspace.getLeavesOfType('galaxy')[0].view.renderer.ok), true)
await page2.waitForSelector('.gx-dock')
await again.close()
assert.deepEqual(errors, [])
console.log(`smoke ok, screenshot: ${shot}`)
