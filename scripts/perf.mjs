// Speed check on a generated vault (default 10,000 notes) in the real app, on the second monitor.
// Targets (agreed with the user): open in 2–3 s, search < 100 ms. Usage: npm run build && node scripts/perf.mjs [notes]
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const N = Number(process.argv[2] ?? 10000)
const root = await mkdtemp(join(tmpdir(), 'aether-perf-'))
const vault = join(root, 'vault')
const words = 'ядро плагін полотно нотатка зв\'язок рамка граф пошук тег сховище файл редактор'.split(' ')
let seed = 1
const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n }
for (let f = 0; f < 20; f++) await mkdir(join(vault, `Тека ${f}`), { recursive: true })
const writes = []
for (let i = 0; i < N; i++) {
  const links = Array.from({ length: 3 }, () => `[[Нотатка ${rnd(N)}]]`).join(', ')
  const text = `# Нотатка ${i}\n\n${Array.from({ length: 40 }, () => words[rnd(words.length)]).join(' ')}\n\nДив. ${links} #${words[rnd(words.length)]}\n${i === N - 1 ? 'унікальнеслово' : ''}\n`
  writes.push(writeFile(join(vault, `Тека ${i % 20}`, `Нотатка ${i}.md`), text))
  if (writes.length > 500) await Promise.all(writes.splice(0))
}
await Promise.all(writes)

const t0 = Date.now()
const app = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'ud')}`, '--display=2'] })
const page = await app.firstWindow()
page.on('console', (m) => { if (m.text().startsWith('[perf]')) console.log(m.text()) })
await page.waitForSelector('.nav-file-title', { timeout: 120000 })
const shown = Date.now() - t0
await page.waitForFunction(() => app.workspace.layoutReady, null, { timeout: 120000 })
const indexed = Date.now() - t0

const search = await page.evaluate(async () => {
  const t = performance.now()
  app.searchFor('унікальнеслово')
  while (!document.querySelector('.nav-files-container mark')) await new Promise((r) => setTimeout(r, 1))
  return performance.now() - t
})
const graph = await page.evaluate(async () => {
  const t = performance.now()
  await app.openGraph()
  while (!document.querySelector('.graph-node')) await new Promise((r) => setTimeout(r, 20))
  return performance.now() - t
})
await app.close()
console.log(JSON.stringify({ notes: N, launchToTree_ms: shown, launchToIndexed_ms: indexed, search_ms: Math.round(search), graph_ms: Math.round(graph) }))
