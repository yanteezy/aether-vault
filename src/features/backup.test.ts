import { beforeEach, describe, expect, it, vi } from 'vitest'

const P = 'aethel-vault:'
const put = (k: string, v: unknown) => localStorage.setItem(P + k, JSON.stringify(v))
const get = (k: string) => {
  const raw = localStorage.getItem(P + k)
  return raw == null ? undefined : JSON.parse(raw)
}

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, tags: [], x: 0, y: 0, width: 260, height: 160, ...extra })

/** Two workspaces with every kind of data, a theme and some settings — the "before" state of a real user. */
function seed() {
  put('vaults', [
    { id: 'default', name: 'Головне', createdAt: 1 },
    { id: 'b', name: 'Друге', createdAt: 2, theme: 'light' },
  ])
  put('active-vault', 'b')
  put('notes', [note('n1', { body: 'текст', image: { id: 'img-abc' } }), note('n2')])
  put('connections', [{ id: 'c1', from: 'n1', to: 'n2' }])
  put('frames', [{ id: 'f1', title: 'Рамка', x: 0, y: 0, width: 500, height: 400, color: 'cyan' }])
  put('chips', [{ id: 't1', tag: 'ідея', x: 5, y: 5, color: 'accent' }])
  put('ink', [{ id: 's1', tool: 'pen', color: 'chalk', points: [0, 0, 10, 10], x: 0, y: 0 }])
  put('canvas-transform', { x: 1, y: 2, scale: 1.5 })
  put('vault:b:notes', [note('m1')])
  put('settings', { theme: 'glass', accent: '#ff0000', lang: 'en', gridStyle: 'dots', vaultName: 'Головне' })
  put('view-mode', 'canvas')
}

describe('backup (.aether)', () => {
  let backup: typeof import('./backup')
  let images: typeof import('./images')
  beforeEach(async () => {
    vi.resetModules()
    backup = await import('./backup')
    images = await import('./images')
  })

  it('round-trips every section: create → file text → parse → apply', async () => {
    seed()
    await images.putImage('img-abc', new Blob(['PNGDATA'], { type: 'image/png' }))
    const before = Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith(P)).map((k) => [k, localStorage.getItem(k)]))

    const file = JSON.stringify(await backup.createBackup(backup.BACKUP_SECTIONS))
    const parsed = backup.parseBackup(file)
    expect(parsed.sections).toEqual(['notes', 'themes', 'settings'])
    expect(backup.summarize(parsed)).toMatchObject({ vaults: 2, notes: 3, images: 1 })
    // theme keys go with "themes", not "settings"; the workspace name stays out of settings
    expect(parsed.themes!.settings).toMatchObject({ theme: 'glass', accent: '#ff0000' })
    expect(parsed.settings!.settings).not.toHaveProperty('theme')
    expect(parsed.settings!.settings).not.toHaveProperty('vaultName')

    // a fresh computer
    localStorage.clear()
    await backup.applyBackup(parsed, parsed.sections)

    for (const k of ['notes', 'connections', 'frames', 'chips', 'ink', 'canvas-transform', 'vault:b:notes', 'active-vault', 'view-mode'])
      expect(localStorage.getItem(P + k), k).toBe(before[P + k])
    expect(get('vaults')).toEqual([
      { id: 'default', name: 'Головне', createdAt: 1 },
      { id: 'b', name: 'Друге', createdAt: 2, theme: 'light' },
    ])
    expect(get('settings')).toMatchObject({ theme: 'glass', accent: '#ff0000', lang: 'en', gridStyle: 'dots' })
    expect(get('import-done')).toMatchObject({ revert: false })
    expect(await images.allIds()).toContain('img-abc')
  })

  it('exports one workspace only when asked', async () => {
    seed()
    const b = await backup.createBackup(['notes'], 'b')
    expect(b.notes!.vaults.map((v) => v.id)).toEqual(['b'])
    expect(b.themes).toBeUndefined()
  })

  it('keeps a way back: "Restore as before" brings the previous state and drops imported workspaces', async () => {
    seed()
    const original = { notes: localStorage.getItem(P + 'notes'), vaults: get('vaults') }
    const incoming = backup.parseBackup(
      JSON.stringify({
        format: 'aether-backup',
        version: 1,
        app: '0.2.24',
        createdAt: '2026-01-01',
        sections: ['notes'],
        notes: {
          vaults: [
            { id: 'default', name: 'Чуже', createdAt: 9, data: { notes: [note('x1')] } },
            { id: 'new', name: 'Нове', createdAt: 10, data: { notes: [note('y1')] } },
          ],
          images: {},
        },
      }),
    )
    await backup.applyBackup(incoming, ['notes'])
    expect(get('notes').map((n: { id: string }) => n.id)).toEqual(['x1'])
    // imported notes replace the vault's data entirely (no leftovers of the old connections)
    expect(get('connections')).toBeUndefined()
    expect(get('vaults').map((v: { id: string }) => v.id)).toEqual(['default', 'b', 'new'])
    // the other workspace on this computer stays
    expect(get('vault:b:notes')).toHaveLength(1)
    expect(backup.hasPreImport()).toBe(true)

    vi.resetModules()
    backup = await import('./backup')
    await backup.revertImport()
    expect(localStorage.getItem(P + 'notes')).toBe(original.notes)
    expect(get('vaults').map((v: { id: string }) => v.id)).toEqual(original.vaults.map((v: { id: string }) => v.id))
    expect(get('vault:new:notes')).toBeUndefined()
    expect(backup.hasPreImport()).toBe(false)
  })

  it('refuses files that are not backups, with a short reason', () => {
    expect(() => backup.parseBackup('{oops')).toThrow('not-json')
    expect(() => backup.parseBackup('{"format":"other"}')).toThrow('not-aether')
    expect(() => backup.parseBackup('{"format":"aether-backup","version":2}')).toThrow('too-new')
  })

  it('makes plain ASCII file names', () => {
    expect(backup.backupFileName()).toMatch(/^aether-backup-\d{4}-\d{2}-\d{2}\.aether$/)
    expect(backup.backupFileName('My Board!')).toMatch(/^aether-board-my-board-\d{4}-\d{2}-\d{2}\.aether$/)
    expect(backup.backupFileName('Дошка')).toMatch(/^aether-board-board-/)
  })
})
