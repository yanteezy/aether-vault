// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importBackup, readBackup, safePath, writeBackup } from './backup.js'

describe('backups', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'backup-'))
  const files: Record<string, string> = {
    'Ідеї.md': '# Ідеї\n' + 'довгий текст '.repeat(200),
    'Проєкти/План.md': 'кроки',
    'Дошка.canvas': '{"nodes":[],"edges":[]}',
    'attachments/фото.png': 'PNGDATA',
    '.obsidian/app.json': '{}',
    '.aether/galaxy-cache.json': '{}',
    '.trash/Стара.md': 'видалена',
  }
  for (const [p, t] of Object.entries(files)) { await mkdir(join(vault, p, '..'), { recursive: true }); await writeFile(join(vault, p), t) }
  const out = await mkdtemp(join(tmpdir(), 'backup-out-'))
  const names = (m: Map<string, Buffer>) => [...m.keys()].sort()

  it('«Усе» packs notes, canvases, photos and settings, not the trash or caches; only the app reads the file', async () => {
    const r = await writeBackup(vault, 'all', join(out, 'all.aetherbackup'), 'Мої нотатки')
    expect(r.files).toBe(5)
    const raw = await readFile(join(out, 'all.aetherbackup'))
    expect(raw.subarray(0, 8).toString()).toBe('AETHERBK')
    expect(raw.includes(Buffer.from('PK\u0003\u0004'))).toBe(false) // not a ZIP any other program would open
    expect(raw.includes(Buffer.from('Ідеї'))).toBe(false)
    const { meta, files: got } = await readBackup(join(out, 'all.aetherbackup'))
    expect(meta).toMatchObject({ app: 'aether', vault: 'Мої нотатки', mode: 'all', files: 5 })
    expect(names(got)).toEqual(['.obsidian/app.json', 'attachments/фото.png', 'Дошка.canvas', 'Ідеї.md', 'Проєкти/План.md'].sort())
    expect(got.get('Ідеї.md')!.toString()).toBe(files['Ідеї.md'])
  })

  it('«Лише нотатки» packs only notes and canvases; the vault is only read', async () => {
    await writeBackup(vault, 'notes', join(out, 'notes.aetherbackup'), 'Мої нотатки')
    expect(names((await readBackup(join(out, 'notes.aetherbackup'))).files)).toEqual(['Дошка.canvas', 'Ідеї.md', 'Проєкти/План.md'].sort())
    expect(await readFile(join(vault, 'Ідеї.md'), 'utf8')).toBe(files['Ідеї.md'])
  })

  it('import makes a new folder next to anything existing, never overwriting', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'backup-into-'))
    await mkdir(join(parent, 'Мої нотатки'))
    await writeFile(join(parent, 'Мої нотатки', 'Ідеї.md'), 'моє')
    const r = await importBackup(join(out, 'all.aetherbackup'), parent)
    expect(r.path).toBe(join(parent, 'Мої нотатки (2)'))
    expect(r.files).toBe(5)
    expect(await readFile(join(r.path, 'Проєкти', 'План.md'), 'utf8')).toBe('кроки')
    expect(await readFile(join(parent, 'Мої нотатки', 'Ідеї.md'), 'utf8')).toBe('моє')
    expect((await readdir(r.path)).includes('.aether-backup.json')).toBe(false)
  })

  it('refuses other files and damaged copies', async () => {
    await writeFile(join(out, 'other.aetherbackup'), 'PK something else')
    await expect(readBackup(join(out, 'other.aetherbackup'))).rejects.toThrow('Це не резервна копія Aether.')
    const raw = await readFile(join(out, 'all.aetherbackup'))
    raw[raw.length - 5] ^= 1
    await writeFile(join(out, 'broken.aetherbackup'), raw)
    await expect(readBackup(join(out, 'broken.aetherbackup'))).rejects.toThrow('Файл копії пошкоджений.')
  })

  it('never writes outside the new folder', () => {
    expect(['../x.md', 'a/../../x', '/etc/x', 'C:/x', 'a\\b', 'a//b', './a'].map(safePath)).toEqual(Array(7).fill(null))
    expect(safePath('Проєкти/План.md')).toBe('Проєкти/План.md')
  })
})
