import { test as base, expect, type Page } from '@playwright/test'

/**
 * Every test starts like a returning user on an empty board: language already picked, first-time hints done,
 * splash already seen this session, and an empty first workspace (instead of the feature guide).
 * Only set when missing, so a reload inside a test keeps what the test saved.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, provide) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await provide(errors)
  },
  page: async ({ page }, provide) => {
    await page.addInitScript(() => {
      const P = 'aethel-vault:'
      const seed: Record<string, string> = {
        [P + 'lang-chosen']: 'true',
        [P + 'settings']: JSON.stringify({ language: 'uk' }),
        [P + 'hints-done']: 'true',
        // already past the one-time "old demo → guide" upgrade (it would treat an empty board as the old demo)
        [P + 'guide-migrated']: '1',
        [P + 'notes']: '[]',
        [P + 'connections']: '[]',
        [P + 'frames']: '[]',
        [P + 'chips']: '[]',
        [P + 'ink']: '[]',
      }
      for (const [k, v] of Object.entries(seed)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v)
      sessionStorage.setItem('aether:splash-shown', '1')
    })
    await provide(page)
  },
})
export { expect }

export const notes = (page: Page) => page.locator('[data-note-id]')

/** Open the app and wait for the empty board. */
export async function openBoard(page: Page) {
  await page.goto('/')
  await expect(page.locator('.canvas-board')).toBeVisible()
}

/** Double-click an empty spot of the board: a new note opens for editing. */
export async function createNote(page: Page, at: { x: number; y: number }, title: string) {
  await page.locator('.canvas-board').dblclick({ position: at })
  const input = page.locator('.note-card.is-editing textarea.note-card__title')
  await expect(input).toBeFocused()
  await input.fill(title)
  // leave editing
  await page.keyboard.press('Escape')
  await expect(page.locator('.note-card.is-editing')).toHaveCount(0)
}

/** What the app saved for the first workspace (browser mode keeps it in localStorage). */
export const savedNotes = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('aethel-vault:notes') ?? '[]') as { id: string; title: string }[])
