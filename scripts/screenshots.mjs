// Screenshots for README.md (docs/screenshots/*.png): a demo vault in a temp folder, the real app on the second
// monitor. Run: npm run build && node scripts/screenshots.mjs
import { _electron as electron } from 'playwright'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'aether-shots-'))
const vault = join(root, 'Дипломна робота')
const out = 'docs/screenshots'
await mkdir(out, { recursive: true })
const write = async (path, text) => { await mkdir(join(vault, path, '..'), { recursive: true }); await writeFile(join(vault, path), text) }

// notes: a thesis on urban heat islands, with links, tags and a backlink or two
await write('Огляд літератури.md', `# Огляд літератури

Основа — три групи робіт: супутникові вимірювання температури поверхні, моделі міського клімату і дослідження зелених дахів.

## Ключові джерела
- Oke (1982): класичний опис [[Острів тепла|острова тепла]] над щільною забудовою.
- Супутникові дані Landsat 8, канал 10 — див. [[Методика вимірювань]].
- Порівняння районів Києва: [[Дані по районах]].

> Різниця між центром і передмістям влітку сягає 4–6 °C, вночі більша, ніж удень.

- [x] Зібрати статті 2015–2025
- [ ] Перевірити цитування в розділі 2

#диплом #джерела
`)
await write('Острів тепла.md', `# Острів тепла

Місто нагрівається сильніше за околиці через асфальт, бетон, мало зелені та тепло від транспорту. Найбільший ефект — у безвітряні літні ночі.

Пов'язане: [[Огляд літератури]], [[Зелені дахи]]. #диплом #теорія
`)
await write('Методика вимірювань.md', `# Методика вимірювань

1. Знімки Landsat 8 за червень–серпень 2023–2025.
2. Маска хмар, переведення каналу 10 у температуру поверхні.
3. Середнє по кожному району — у [[Дані по районах]].

#диплом #методика
`)
await write('Дані по районах.md', `# Дані по районах

| Район | Літо, °C | Зелень, % |
| --- | --- | --- |
| Печерський | 34,1 | 31 |
| Оболонський | 31,8 | 44 |
| Дарницький | 33,2 | 27 |

Висновок для [[Острів тепла]]: що менше зелені, то вища температура поверхні. #диплом
`)
await write('Зелені дахи.md', '# Зелені дахи\n\nЗнижують температуру покрівлі на 10–20 °C, у кварталі — на 1–2 °C. Приклади: Відень, Копенгаген. #теорія')
await write('Щоденник/2026-11-24.md', '# 24 листопада\n\nЗустріч з керівником: скоротити розділ 1, додати карту районів. [[Огляд літератури]]')
await write('Щоденник/2026-11-26.md', '# 26 листопада\n\nПерерахував температуру для Дарниці, оновив [[Дані по районах]].')
// a bigger sky for the Galaxy: notes in a few folders with tags and links between them
const topics = [['Курси', 'навчання'], ['Проєкти', 'робота'], ['Книги', 'читання'], ['Ідеї', 'ідеї'], ['Подорожі', 'подорожі']]
for (const [folder, tag] of topics) {
  for (let i = 1; i <= 28; i++) {
    const links = [((i * 7) % 28) + 1, ((i * 11) % 28) + 1].map((k) => `[[${folder} ${k}]]`).join(' ')
    await write(`${folder}/${folder} ${i}.md`, `# ${folder} ${i}\n\nНотатка про ${tag}. ${i % 3 === 0 ? links : ''} #${tag}`)
  }
}

// the board
const card = (id, text, x, y, w, h, extra = {}) => ({ id, type: 'text', text, x, y, width: w, height: h, ...extra })
await write('Полотно.canvas', JSON.stringify({
  nodes: [
    { id: 'g1', type: 'group', label: 'Розділ 1. Теорія', x: -40, y: -60, width: 760, height: 420, color: '5' },
    { id: 'g2', type: 'group', label: 'Розділ 2. Дослідження', x: 780, y: -60, width: 620, height: 420, color: '4' },
    card('t', 'Дипломна робота', -40, -260, 1440, 150, { 'aether-style': 'banner', color: '#0a84ff' }),
    { id: 'n1', type: 'file', file: 'Огляд літератури.md', x: 0, y: 0, width: 320, height: 300 },
    { id: 'n2', type: 'file', file: 'Острів тепла.md', x: 360, y: 0, width: 320, height: 170 },
    card('c1', 'Гіпотеза\n\nУ районах, де зелені менше 30 %, літня температура поверхні вища на 2 °C і більше.', 360, 200, 320, 130, { 'aether-style': 'headline', color: '3' }),
    { id: 'n3', type: 'file', file: 'Методика вимірювань.md', x: 820, y: 0, width: 300, height: 200 },
    { id: 'n4', type: 'file', file: 'Дані по районах.md', x: 820, y: 230, width: 540, height: 110 },
    card('c2', 'Термін\n\nЧернетка — 15 грудня, захист — 20 січня.', 1150, 0, 210, 200, { 'aether-style': 'quote', color: '6' }),
    card('c3', 'Далі\n\nКарта районів\nПорівняння з Віднем\nВисновки', -40, 420, 320, 170, { 'aether-style': 'bullets' }),
    card('c4', 'Зелені дахи як рішення', 360, 420, 360, 170, { 'aether-style': 'caps', color: '4' }),
  ],
  edges: [
    { id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left' },
    { id: 'e2', fromNode: 'n2', fromSide: 'right', toNode: 'n3', toSide: 'left' },
    { id: 'e3', fromNode: 'n3', fromSide: 'bottom', toNode: 'n4', toSide: 'top' },
    { id: 'e4', fromNode: 'c1', fromSide: 'bottom', toNode: 'c4', toSide: 'top' },
  ],
}, null, '\t'))
// a hand-drawn circle around the hypothesis and an arrow to the data
const circle = Array.from({ length: 40 }, (_, k) => { const a = (k / 39) * Math.PI * 2.1; return [Math.round(520 + Math.cos(a) * 190), Math.round(265 + Math.sin(a) * 85)] })
await write('.aether/canvas-extra/Полотно.canvas.json', JSON.stringify({ strokes: [
  { id: 's1', points: circle, width: 3, color: '#ff6b6b' },
  { id: 's2', points: [[715, 300], [760, 320], [800, 320], [815, 300], [800, 290], [815, 300], [800, 312]], width: 3, color: '#ff6b6b' },
] }))
await write('.aether/workspace.json', JSON.stringify({ tabs: [{ file: 'Полотно.canvas', mode: 'source' }], active: 0 }))

const app = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'ud')}`, '--display=2'] })
const page = await app.firstWindow()
await page.waitForFunction(() => window.app?.workspace?.layoutReady)
const shot = async (name) => { await page.mouse.move(5, 300); await page.waitForTimeout(900); await page.screenshot({ path: join(out, `${name}.png`) }) }

await page.waitForSelector('.canvas-node')
for (const name of ['Ідеї', 'Книги', 'Курси', 'Подорожі', 'Проєкти', 'Щоденник']) {
  const folder = page.locator('.nav-folder-title', { hasText: new RegExp(`^${name}$`) })
  if (await folder.count() && (await folder.first().getAttribute('aria-expanded')) !== 'false') await folder.first().click()
}
await page.waitForTimeout(1500)
await shot('canvas')

await page.evaluate(() => app.workspace.getLeaf(true).openFile(app.vault.getFileByPath('Огляд літератури.md')))
await page.waitForTimeout(800)
await page.evaluate(() => app.workspace.getActiveViewOfType?.(Object) ?? null).catch(() => {})
await shot('notes')

await page.getByRole('button', { name: 'Галактика', exact: true }).click()
await page.waitForFunction(() => app.workspace.getLeavesOfType('galaxy')[0]?.view?.data?.count > 100, null, { timeout: 20000 })
await page.getByRole('button', { name: 'Тегами' }).click()
await page.waitForTimeout(2500)
await shot('galaxy')

await page.getByRole('button', { name: 'Полотно', exact: true }).click()
await page.waitForTimeout(600)
const node = page.locator('.canvas-node[data-id="c1"]')
await node.click({ button: 'right' })
await page.locator('.note-menu__fold').click()
await page.waitForTimeout(500)
await shot('card-menu')
await page.keyboard.press('Escape')

await page.evaluate(() => app.setting.open())
await page.locator('.vertical-tab-nav-item', { hasText: 'Резервні копії' }).click()
await shot('backups')

await app.close()
console.log(`screenshots in ${out}`)
