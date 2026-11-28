// The canvas in the real app (second monitor): cards, an edge, a group, zoom, keyboard moves, colours, drawing, undo,
// and that a .canvas file from another app keeps the fields we do not know.
// Usage: npm run build && node scripts/canvas-smoke.mjs [screenshot.png]
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const shot = process.argv[2] ?? join(tmpdir(), 'aether-canvas.png')
const root = await mkdtemp(join(tmpdir(), 'aether-canvas-'))
const vault = join(root, 'Сховище')
await mkdir(vault, { recursive: true })
await writeFile(join(vault, 'План.md'), '# План\n- Ядро\n- Плагіни\n- Полотно #робота')
const foreign = { nodes: [{ id: 'f1', type: 'text', text: 'З Obsidian', x: 0, y: 0, width: 200, height: 100, styleAttributes: { shape: 'pill' } }], edges: [], metadata: { frontmatter: {} } }
await writeFile(join(vault, 'Чуже.canvas'), JSON.stringify(foreign, null, '\t'))
await writeFile(join(vault, 'Малюнки.canvas'), '{"nodes":[],"edges":[]}') // an empty board for selecting and moving drawings

const app = await electron.launch({ args: ['.', `--vault=${vault}`, `--user-data-dir=${join(root, 'user-data')}`, '--display=2'] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const readCanvas = async (name) => JSON.parse(await readFile(join(vault, name), 'utf8'))
const settle = () => page.waitForTimeout(700)

await page.waitForSelector('.nav-file-title')
await page.getByRole('button', { name: 'Полотно', exact: true }).click()
await page.waitForSelector('.canvas-wrapper')
assert.equal(await page.getAttribute('.aether-segmented button:first-child', 'aria-pressed'), 'true')

// text card from the dock
await page.getByRole('button', { name: 'Картка', exact: true }).click()
await page.keyboard.type('Ідея **важлива**')
await page.keyboard.press('Escape')
await page.waitForSelector('.canvas-node-text strong')

// note card from the command (the keyboard way)
await page.evaluate(() => app.commands.executeCommandById('canvas:add-note'))
await page.getByRole('button', { name: 'Додати' }).click()
await page.waitForSelector('.canvas-node-file .canvas-node-content li')

// double click edits a card in place and never adds another one
const cards = await page.locator('.canvas-node').count()
await page.dblclick('.canvas-node-text', { position: { x: 30, y: 30 } })
await page.waitForSelector('.canvas-node-text textarea')
assert.equal(await page.locator('.canvas-node').count(), cards)
await page.keyboard.press('Escape')
await page.dblclick('.canvas-node-file', { position: { x: 30, y: 60 } })
await page.waitForSelector('.canvas-node-file textarea')
await page.keyboard.press('Control+End')
await page.keyboard.type('\n- Зміна з полотна')
await page.keyboard.press('Escape')
await page.waitForSelector('.canvas-node-file li >> text=Зміна з полотна')
assert.match(await readFile(join(vault, 'План.md'), 'utf8'), /- Зміна з полотна$/)
assert.equal(await page.locator('.canvas-node').count(), cards)

// the plus on a side is invisible until the cursor is in that side's area, even on a selected card
await page.click('.canvas-node-text', { position: { x: 30, y: 30 } })
const plus = (side) => page.$eval(`.canvas-node-text .mod-${side}`, (el) => getComputedStyle(el, '::after').opacity)
assert.equal(await plus('right'), '0')
await page.hover('.canvas-node-text .mod-right')
await page.waitForTimeout(250)
assert.equal(await plus('right'), '1')
assert.equal(await plus('left'), '0')

// connect the text card to the note card from its menu
await page.focus('.canvas-node-text')
await page.keyboard.press('Shift+F10')
await page.getByRole('button', { name: /З.єднати з…/ }).click()
await page.getByRole('button', { name: "З'єднати" }).click()
await page.waitForSelector('.canvas-edge-path', { state: 'attached' })

// select both, frame them, move the frame with the keyboard (cards inside move with it)
await page.click('.canvas-node-text', { position: { x: 20, y: 20 } })
await page.click('.canvas-node-file', { position: { x: 20, y: 20 }, modifiers: ['Shift'] })
await page.getByRole('button', { name: 'Рамка' }).click()
await page.waitForSelector('.canvas-node-group')
await settle()
const before = await readCanvas('Полотно.canvas')
await page.focus('.canvas-node-group')
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')

await page.getByRole('button', { name: 'Збільшити' }).click()
assert.equal(await page.textContent('.aether-zoom button:nth-child(2)'), '125%')
await settle()
await page.screenshot({ path: shot })

const after = await readCanvas('Полотно.canvas')
assert.deepEqual(after.nodes.map((n) => n.type).sort(), ['file', 'group', 'text'])
assert.equal(after.edges.length, 1)
for (const n of after.nodes) assert.equal(n.x, before.nodes.find((b) => b.id === n.id).x + 20, `${n.type} moved with the frame`)
assert.equal(after.nodes.find((n) => n.type === 'file').file, 'План.md')

// Aether's right-click menu: colour, card type, font; Escape closes it
await page.click('.canvas-node-text', { button: 'right', position: { x: 20, y: 20 } })
await page.waitForSelector('.note-menu')
await page.waitForTimeout(400) // after the opening spring
await page.screenshot({ path: shot.replace(/\.png$/, '-menu.png') })
await page.getByRole('radio', { name: 'Зелений' }).click()
await page.locator('.note-menu__fold').click() // card type and font live in the folded «Вигляд картки»
await page.locator('.note-menu__style--headline').click()
await page.locator('.note-menu .font-tile[title="Із засічками"]').click()
await page.keyboard.press('Escape')
assert.equal(await page.locator('.note-menu').count(), 0)
await settle()
const styled = (await readCanvas('Полотно.canvas')).nodes.find((n) => n.type === 'text')
assert.equal(styled.color, '4')
assert.equal(styled['aether-style'], 'headline')
assert.equal(styled['aether-font'], 'serif')

// connecting by dragging a side's plus never selects text on the page; Escape mid-drag cancels it
const edgesBefore = (await readCanvas('Полотно.canvas')).edges.length
await page.click('.canvas-wrapper', { position: { x: 30, y: 30 } }) // deselect: the frame no longer covers the cards' sides
const plusBox = await page.locator('.canvas-node-text .mod-right').boundingBox()
await page.mouse.move(plusBox.x + plusBox.width / 2, plusBox.y + plusBox.height / 2)
await page.mouse.down()
await page.mouse.move(plusBox.x + 200, plusBox.y + 120, { steps: 8 })
assert.equal(await page.evaluate(() => window.getSelection().toString()), '')
await page.keyboard.press('Escape')
await page.mouse.up()
assert.equal(await page.locator('.canvas-edge-path.is-drafting').count(), 0)
await settle()
assert.equal((await readCanvas('Полотно.canvas')).edges.length, edgesBefore)
// Escape on the canvas leaves no blue focus ring around it
await page.keyboard.press('Escape')
assert.equal(await page.$eval('.canvas-wrapper', (el) => getComputedStyle(el).boxShadow), 'none')

// draw a stroke: it is kept in .aether/canvas-extra and the .canvas file stays as it is; undo, redo
const canvasText = await readFile(join(vault, 'Полотно.canvas'), 'utf8')
const strokes = async () => JSON.parse(await readFile(join(vault, '.aether', 'canvas-extra', 'Полотно.canvas.json'), 'utf8')).strokes
const draw = page.getByRole('button', { name: 'Малювати' })
await draw.click()
assert.equal(await draw.getAttribute('aria-pressed'), 'true')
const box = await page.locator('.canvas-wrapper').boundingBox()
await page.mouse.move(box.x + 40, box.y + 60)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 40 + i * 15, box.y + 60 + (i % 2) * 20)
await page.mouse.up()
await settle()
assert.equal(await page.locator('.canvas-stroke').count(), 1)
assert.equal((await strokes()).length, 1)
assert.ok((await strokes())[0].points.length > 5)
assert.equal(await readFile(join(vault, 'Полотно.canvas'), 'utf8'), canvasText)
await page.keyboard.press('Control+z')
await settle()
assert.equal(await page.locator('.canvas-stroke').count(), 0)
assert.deepEqual(await strokes(), [])
await page.keyboard.press('Control+Shift+z')
await settle()
assert.equal((await strokes()).length, 1)
await page.keyboard.press('Escape')
assert.equal(await draw.getAttribute('aria-pressed'), 'false')
assert.equal(await readFile(join(vault, 'Полотно.canvas'), 'utf8'), canvasText)
// one drawing: right-click it → «Видалити малюнок» removes just that one; the colour strip rings are not clipped
await draw.click()
const ring = await page.locator('.aether-ink-swatch[aria-pressed="true"]').boundingBox(), strip = await page.locator('.aether-ink').boundingBox()
assert.ok(ring.y - 4 >= strip.y && ring.y + ring.height + 4 <= strip.y + strip.height, 'the chosen colour ring fits the strip')
await page.mouse.move(box.x + 40, box.y + 220); await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 40 + i * 15, box.y + 220)
await page.mouse.up()
await settle()
assert.equal((await strokes()).length, 2)
await page.mouse.click(box.x + 100, box.y + 220, { button: 'right' })
await page.locator('.menu-item', { hasText: 'Видалити малюнок' }).click()
await settle()
assert.equal((await strokes()).length, 1)
assert.equal(await page.locator('.canvas-stroke').count(), 1)
await page.keyboard.press('Escape')

// layers: drawings sit among the cards; a card brought to the front covers a drawing, and back again
assert.equal(await draw.getAttribute('aria-pressed'), 'false') // Escape left drawing
const v = () => 'app.workspace.getLeavesOfType("canvas").find((l) => l.view.strokes?.length).view'
await page.evaluate(`(() => { const v = ${v()}; const [x, y] = v.strokes[0].points[0]; v.addTextCard({ x: x + 10, y: y - 30 }) })()`)
await page.keyboard.press('Escape')
await settle()
// true when the drawing is painted after (over) the newest card
const drawingOnTop = () => page.evaluate(`(() => { const v = ${v()}; const card = v.nodeEls.get(v.data.nodes.filter((n) => n.type !== 'group').at(-1).id); return !!(card.compareDocumentPosition(document.querySelector('.canvas-stroke')) & Node.DOCUMENT_POSITION_FOLLOWING) })()`)
assert.equal(await drawingOnTop(), false, 'a new card lies over an older drawing')
const menuOn = (sel) => page.evaluate((s) => { const el = s === 'top card' ? [...document.querySelectorAll('.canvas-node:not(.canvas-node-group)')].at(-1) : document.querySelector(s); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 })) }, sel)
await menuOn('.canvas-stroke .canvas-stroke-hit')
await page.locator('.menu-item', { hasText: 'На передній план' }).click()
assert.equal(await drawingOnTop(), true, 'the drawing brought to the front')
assert.equal(typeof (await strokes())[0].z, 'number')
await menuOn('top card')
await page.getByRole('button', { name: 'На передній план' }).or(page.locator('.menu-item', { hasText: 'На передній план' })).first().click()
await settle()
assert.equal(await drawingOnTop(), false, 'the card brought to the front covers the drawing')
await page.keyboard.press('Escape')

// two drawings on an empty board: click one, Ctrl+click the other, Ctrl+X cuts both, Ctrl+V puts them back
await page.getByRole('treeitem', { name: /Малюнки/ }).click()
await page.waitForFunction(() => app.workspace.activeLeaf?.view?.file?.path === 'Малюнки.canvas')
await settle()
const board = async () => JSON.parse(await readFile(join(vault, '.aether', 'canvas-extra', 'Малюнки.canvas.json'), 'utf8')).strokes
await page.evaluate(`(() => { const v = app.workspace.activeLeaf.view; const r = v.wrapper.getBoundingClientRect(); for (const dy of [300, 340]) { const a = v.toWorld(r.x + 400, r.y + dy), b = v.toWorld(r.x + 560, r.y + dy); v.addStroke([[a.x, a.y], [b.x, b.y]]) } })()`)
await settle()
const n0 = (await board()).length
await page.mouse.click(box.x + 480, box.y + 300)
await page.keyboard.down('Control'); await page.mouse.click(box.x + 480, box.y + 340); await page.keyboard.up('Control')
assert.equal(await page.locator('.canvas-stroke.is-selected').count(), 2)
await page.keyboard.press('Control+x')
await settle()
assert.equal((await board()).length, n0 - 2)
await page.keyboard.press('Control+v')
await settle()
assert.equal((await board()).length, n0)
assert.equal(await page.locator('.canvas-stroke.is-selected').count(), 2)
await page.keyboard.press('Escape')

// drag the two selected drawings by pressing on one: both move, one undo step
const firstX = async () => Object.fromEntries((await board()).map((x) => [x.id, x.points[0][0]]))
const xBefore = await firstX()
await page.mouse.click(box.x + 480, box.y + 300)
await page.keyboard.down('Control'); await page.mouse.click(box.x + 480, box.y + 340); await page.keyboard.up('Control')
await page.mouse.move(box.x + 480, box.y + 300); await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 480 + i * 10, box.y + 300)
await page.mouse.up()
await settle()
const xAfter = await firstX()
assert.equal(Object.keys(xAfter).filter((id) => xAfter[id] > xBefore[id] + 20).length, 2, 'both selected drawings moved')
await page.keyboard.press('Control+z')
await settle()
assert.deepEqual(await firstX(), xBefore)

// while drawing, Ctrl+drag draws nothing: it is a selection box that takes drawings
await page.keyboard.press('Escape')
await draw.click()
await page.keyboard.down('Control')
// the box starts on the empty board and reaches over both drawings
const [sx, sy] = [box.x + 620, box.y + 380]
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(box.x + 385, box.y + 290, { steps: 6 }); await page.mouse.up()
await page.keyboard.up('Control')
await settle()
assert.equal((await board()).length, n0, 'Ctrl+drag drew nothing')
assert.equal(await page.locator('.canvas-stroke.is-selected').count(), 2)
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

// another app's canvas: move a card, keep its unknown fields
await page.getByRole('treeitem', { name: /Чуже/ }).click()
await page.waitForSelector('.canvas-node-text >> text=З Obsidian')
await page.focus('.canvas-node-text')
await page.keyboard.press('ArrowDown')
await settle()
const kept = await readCanvas('Чуже.canvas')
assert.deepEqual(kept.metadata, foreign.metadata)
assert.deepEqual(kept.nodes[0].styleAttributes, { shape: 'pill' })
assert.equal(kept.nodes[0].y, 10)

await app.close()
assert.deepEqual(errors, [])
console.log(`canvas smoke ok, screenshot: ${shot}`)
