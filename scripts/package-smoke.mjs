// Starts the packaged app (release/win-unpacked/Aether.exe, from `npm run dist`) on a temp vault,
// types into a note and checks the file on disk. Proves the asar runs without node_modules.
// Usage: node scripts/package-smoke.mjs
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = await mkdtemp(join(tmpdir(), 'aether-package-smoke-'))
const vault = join(root, 'vault')
await mkdir(vault)
const note = join(vault, 'Нотатка.md')
await writeFile(note, '# Нотатка\n\nТекст.\n')

const app = await electron.launch({
  executablePath: resolve('release/win-unpacked/Aether.exe'),
  args: [`--vault=${vault}`, `--user-data-dir=${join(root, 'user-data')}`, '--display=2'],
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.waitForSelector('.nav-file-title')
await page.getByRole('treeitem', { name: 'Нотатка' }).click()
await page.click('.cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('Із пакета.')
await page.waitForTimeout(900)
assert.match(await readFile(note, 'utf8'), /Із пакета\.$/)
await app.close()
assert.deepEqual(errors, [])
console.log('package smoke ok')
