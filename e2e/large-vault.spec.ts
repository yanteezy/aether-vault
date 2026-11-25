import { test, expect, openBoard } from './fixtures'

test('a large vault draws only what is near the screen, and every note stays reachable', async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    const list = [...Array(2000)].map((_, i) => ({ id: `n${i}`, title: `Нотатка ${i}`, tags: [], x: (i % 40) * 300, y: Math.floor(i / 40) * 200, width: 260, height: 160 }))
    localStorage.setItem('aethel-vault:notes', JSON.stringify(list))
    sessionStorage.setItem('seeded', '1')
  })
  await openBoard(page)
  const cards = page.locator('.note-card')
  await expect(page.locator('[data-note-id="n0"]')).toBeVisible()
  expect(await cards.count()).toBeLessThan(250)
  // the vault list is built only when it is opened
  await expect(page.locator('.side-panel__item')).toHaveCount(0)

  // a note far away is reached by search and becomes a real card
  await page.keyboard.press('Space')
  await page.keyboard.type('Нотатка 1999')
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-card[data-note-id="n1999"]')).toBeVisible()

  // zoomed far out: plain tiles instead of hundreds of cards; a click makes the tile a card
  await page.mouse.move(1100, 500)
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 100)
  const tiles = page.locator('.note-tile')
  await expect.poll(() => tiles.count()).toBeGreaterThan(300)
  expect(await cards.count()).toBeLessThan(5)
  const box = (await page.locator('.note-tile').filter({ hasText: 'Нотатка 1900' }).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.note-card.is-selected[data-note-id="n1900"]')).toBeVisible()
  expect(consoleErrors).toEqual([])
})
