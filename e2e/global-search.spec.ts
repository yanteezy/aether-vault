import { createNote, expect, notes, openBoard, savedNotes, test } from './fixtures'

test('10 · Ctrl+Space finds a note of another workspace and takes you to it', async ({ page, consoleErrors }) => {
  await openBoard(page)
  await createNote(page, { x: 400, y: 300 }, 'Секретний рецепт')
  await expect.poll(async () => (await savedNotes(page)).length).toBe(1)

  const tabs = page.getByRole('tab')
  await page.getByRole('button', { name: 'Нове сховище' }).click()
  await expect(tabs).toHaveCount(2)
  await expect(notes(page)).toHaveCount(0)

  await page.keyboard.press('Control+Space')
  const input = page.getByRole('combobox', { name: 'Пошук в усіх сховищах' })
  await expect(input).toBeFocused()
  await input.fill('рецеп')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('option')).toContainText('Aether')
  await page.keyboard.press('Enter')

  await expect(input).toHaveCount(0)
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.note-card.is-selected')).toContainText('Секретний рецепт')

  // it opens and closes with the same keys; plain Space still searches the current workspace only
  await page.keyboard.press('Control+Space')
  await expect(input).toBeVisible()
  await page.keyboard.press('Control+Space')
  await expect(input).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(page.getByRole('dialog', { name: 'Швидкий пошук' })).toBeVisible()
  expect(consoleErrors).toEqual([])
})
