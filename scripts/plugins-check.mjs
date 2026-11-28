// Runs every plugin from test-vault/.aether/plugins in the real app (on a copy of the vault, second monitor)
// and reports, per plugin: did it load, errors it caused, and `obsidian` API it asked for that we lack.
// Usage: npm run build && node scripts/plugins-check.mjs [screenshot.png]
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const root = await mkdtemp(join(tmpdir(), 'aether-plugins-'))
const vault = join(root, 'vault')
await cp('test-vault', vault, { recursive: true })

const app = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'user-data')}`, '--display=2'] })
const page = await app.firstWindow()
let log = []
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${m.type()}: ${m.text().split('\n')[0]}`) })
await page.waitForSelector('.nav-file-title')
// a vault with plugins listed as enabled asks for trust first; this script enables them itself
const trust = page.getByRole('button', { name: 'Лишити вимкненими' })
if (await trust.isVisible().catch(() => false)) await trust.click()

const ids = await page.evaluate(async () => { await app.plugins.loadManifests(); return Object.keys(app.plugins.manifests).sort() })
const report = {}
for (const id of ids) {
  log = []
  const before = await page.evaluate(() => [...app.plugins.missingApi])
  const ok = await page.evaluate((id) => app.plugins.enablePlugin(id), id)
  await page.waitForTimeout(800) // plugins often finish work in onLayoutReady / timers
  const missing = await page.evaluate((before) => [...app.plugins.missingApi].filter((n) => !before.includes(n)), before)
  report[id] = { ok, missing, log: log.filter((l) => !l.includes('Electron Security Warning')) }
}

// use the app with all plugins on
log = []
await page.getByRole('treeitem', { name: 'Ласкаво просимо' }).click()
await page.waitForSelector('.cm-content')
await page.click('.cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('\nНовий рядок після плагінів.')
await page.getByRole('treeitem', { name: 'Список' }).click()
await page.waitForTimeout(600)
report['(usage)'] = { log: log.filter((l) => !l.includes('Electron Security Warning')) }
report['(commands)'] = await page.evaluate(() => Object.keys(app.commands.commands).filter((c) => c.includes(':') && !/^(file|app|editor|workspace|command-palette):/.test(c)).length)
await page.screenshot({ path: process.argv[2] ?? join(root, 'plugins.png') })
await app.close()
console.log(JSON.stringify(report, null, 2))
