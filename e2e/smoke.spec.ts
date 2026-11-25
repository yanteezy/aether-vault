import { createNote, expect, notes, openBoard, savedNotes, test } from './fixtures'

test('1 · the board opens without errors in the console', async ({ page, consoleErrors }) => {
  await openBoard(page)
  await expect(page.getByText('Порожнє полотно')).toBeVisible()
  await page.waitForTimeout(500)
  expect(consoleErrors).toEqual([])
})

test('2 · a new note keeps its text after a reload', async ({ page }) => {
  await openBoard(page)
  await createNote(page, { x: 400, y: 300 }, 'Перевірка збереження')
  await expect(notes(page)).toHaveCount(1)
  await expect.poll(async () => (await savedNotes(page)).map((n) => n.title)).toEqual(['Перевірка збереження'])

  await page.reload()
  await expect(notes(page)).toHaveCount(1)
  await expect(notes(page).first()).toContainText('Перевірка збереження')
})

test('3 · Ctrl+D duplicates two selected notes, Ctrl+Z takes it back', async ({ page }) => {
  await openBoard(page)
  await createNote(page, { x: 300, y: 250 }, 'Перша')
  await createNote(page, { x: 750, y: 250 }, 'Друга')
  await expect(notes(page)).toHaveCount(2)

  await notes(page).nth(0).click()
  await notes(page).nth(1).click({ modifiers: ['ControlOrMeta'] })
  await page.keyboard.press('ControlOrMeta+d')
  await expect(notes(page)).toHaveCount(4)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(notes(page)).toHaveCount(2)
})

test('4 · Delete removes a note, Ctrl+Z brings it back', async ({ page }) => {
  await openBoard(page)
  await createNote(page, { x: 400, y: 300 }, 'Видали мене')
  await notes(page).first().click()
  await page.keyboard.press('Delete')
  await expect(notes(page)).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(notes(page)).toHaveCount(1)
  await expect(notes(page).first()).toContainText('Видали мене')
})

test('5 · a deleted workspace comes back with «Повернути»', async ({ page }) => {
  await openBoard(page)
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(1)
  await page.getByRole('button', { name: 'Нове сховище' }).click()
  await expect(tabs).toHaveCount(2)

  // the close button asks once more before deleting
  const close = tabs.nth(1).getByRole('button', { name: 'Видалити сховище' })
  await close.click()
  await close.click()
  await expect(tabs).toHaveCount(1)

  await page.getByRole('button', { name: 'Повернути' }).click()
  await expect(tabs).toHaveCount(2)
})

test('6 · P starts drawing, Esc leaves it', async ({ page }) => {
  await openBoard(page)
  await page.locator('.canvas-board').click({ position: { x: 600, y: 400 } })
  await page.keyboard.press('p')
  await expect(page.locator('.ink-mode-frame')).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Малювання' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('.ink-mode-frame')).toHaveCount(0)
})

test('7 · Settings → General → Export downloads an .aether file', async ({ page }) => {
  await openBoard(page)
  await createNote(page, { x: 400, y: 300 }, 'У бекапі')
  await page.getByRole('button', { name: 'Налаштування' }).click()
  const dialog = page.getByRole('dialog', { name: 'Налаштування' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Загальні', exact: true }).click()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Експортувати' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^aether-backup-\d{4}-\d{2}-\d{2}\.aether$/)

  const path = await file.path()
  const { readFile } = await import('node:fs/promises')
  const backup = JSON.parse(await readFile(path, 'utf8'))
  expect(backup.format).toBe('aether-backup')
  expect(JSON.stringify(backup.notes)).toContain('У бекапі')
})

test('8 · keyboard: Tab reaches a note, arrows move it, Shift+F10 opens its menu', async ({ page }) => {
  await openBoard(page)
  await createNote(page, { x: 400, y: 300 }, 'Клавіатура')
  const note = notes(page).first()

  // Tab through the page until the note has focus
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await note.evaluate((el) => el === document.activeElement)
  }
  expect(reached, 'Tab reaches the note').toBe(true)

  const before = (await savedNotes(page))[0] as unknown as { x: number; y: number }
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect
    .poll(async () => {
      const n = (await savedNotes(page))[0] as unknown as { x: number; y: number }
      return [n.x - before.x, n.y - before.y]
    })
    .toEqual([8, 8])

  await note.focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})
