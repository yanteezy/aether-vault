import { createNote, expect, notes, openBoard, savedNotes, test } from './fixtures'

test('9 · notes stay with their workspace when switching tabs back and forth, and after a reload', async ({ page, consoleErrors }) => {
  await openBoard(page)
  await createNote(page, { x: 400, y: 300 }, 'Перше сховище')
  await expect.poll(async () => (await savedNotes(page)).map((n) => n.title)).toEqual(['Перше сховище'])

  const tabs = page.getByRole('tab')
  await page.getByRole('button', { name: 'Нове сховище' }).click()
  await expect(tabs).toHaveCount(2)
  await expect(notes(page)).toHaveCount(0)
  await createNote(page, { x: 500, y: 300 }, 'Друге сховище')

  // right away, while the slide between tabs still shows both workspaces
  await tabs.nth(0).click()
  await expect(notes(page)).toHaveCount(1)
  await expect(notes(page).first()).toContainText('Перше сховище')
  await tabs.nth(1).click()
  await expect(notes(page)).toHaveCount(1)
  await expect(notes(page).first()).toContainText('Друге сховище')

  await page.reload()
  await expect(notes(page).first()).toContainText('Друге сховище')
  await page.getByRole('tab').nth(0).click()
  await expect(notes(page)).toHaveCount(1)
  await expect(notes(page).first()).toContainText('Перше сховище')
  expect(consoleErrors).toEqual([])
})
