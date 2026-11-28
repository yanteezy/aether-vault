// Installs plugins from the live community catalog through the settings UI (second monitor),
// enables each and reports errors and missing `obsidian` API. Downloads the plugins from GitHub.
// Usage: npm run build && node scripts/catalog-check.mjs "Dataview,Templater,Excalidraw"
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const names = (process.argv[2] ?? 'Dataview,Templater,Excalidraw').split(',')
const root = await mkdtemp(join(tmpdir(), 'aether-catalog-'))
const vault = join(root, 'vault')
await cp('test-vault', vault, { recursive: true, filter: (p) => !p.includes('.aether') })

const app = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'ud')}`, '--display=2'] })
const page = await app.firstWindow()
let log = []
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('Electron Security Warning')) log.push(`${m.type()}: ${m.text().split('\n')[0].slice(0, 200)}`) })
await page.waitForSelector('.nav-file-title')

await page.getByRole('button', { name: 'Налаштування' }).click()
await page.getByRole('button', { name: 'Увімкнути плагіни спільноти' }).click()
await page.getByRole('button', { name: 'Огляд…' }).click()
// wait for the catalog status to leave «Завантажую…»; an error text ends the run with its reason
let catalogSize = ''
for (let i = 0; i < 120 && (catalogSize = await page.textContent('.mod-catalog [role=status]')).startsWith('Завантажую'); i++) await page.waitForTimeout(500)
if (!catalogSize.startsWith('Плагінів у каталозі')) { console.log(`catalog did not load: ${catalogSize}`); await app.close(); process.exit(1) }

const report = { catalog: catalogSize }
for (const name of names) {
  await page.fill('.mod-catalog input[type=search]', name)
  const row = page.locator('.mod-catalog .setting-item').filter({ has: page.locator('.setting-item-name', { hasText: new RegExp(`^${name}$`, 'i') }) }).first()
  await row.getByRole('button', { name: 'Встановити' }).click()
  await row.getByRole('button', { name: /Встановлено/ }).or(page.locator('.mod-catalog [role=status]', { hasText: 'не встановлено' })).first().waitFor({ timeout: 120000 })
  report[name] = { install: await page.textContent('.mod-catalog [role=status]') }
}
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

for (const name of names) {
  const id = await page.evaluate((n) => Object.values(app.plugins.manifests).find((m) => m.name.toLowerCase() === n.toLowerCase())?.id, name)
  if (!id) continue
  log = []
  const before = await page.evaluate(() => [...app.plugins.missingApi])
  const ok = await page.evaluate((id) => app.plugins.enablePlugin(id), id)
  await page.waitForTimeout(1500)
  const missing = await page.evaluate((before) => [...app.plugins.missingApi].filter((n) => !before.includes(n)), before)
  report[name] = { ...report[name], id, ok, missing, log: [...new Set(log)].slice(0, 8) }
}
log = []
await page.getByRole('treeitem', { name: 'Ласкаво просимо' }).click()
await page.waitForTimeout(1500)
report['(open a note)'] = [...new Set(log)].slice(0, 8)
await page.screenshot({ path: process.argv[3] ?? join(root, 'catalog.png') })
await app.close()
console.log(JSON.stringify(report, null, 2))
