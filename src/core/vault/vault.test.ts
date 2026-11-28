import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSystemAdapter } from './adapter.js'
import { normalizePath, TFile, TFolder } from './files.js'
import { Vault } from './vault.js'

let dir: string
let vault: Vault
const log: string[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vault-'))
  await mkdir(join(dir, 'Projects'))
  await mkdir(join(dir, '.aether'))
  await writeFile(join(dir, 'Home.md'), '# Home')
  await writeFile(join(dir, 'Projects', 'Plan.md'), 'plan')
  await writeFile(join(dir, '.aether', 'app.json'), '{}')
  vault = new Vault(new FileSystemAdapter(dir))
  log.length = 0
  vault.on('create', (f) => log.push(`create ${f.path}`))
  vault.on('modify', (f) => log.push(`modify ${f.path}`))
  vault.on('delete', (f) => log.push(`delete ${f.path}`))
  vault.on('rename', (f, old) => log.push(`rename ${old} -> ${f.path}`))
  await vault.load()
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('normalizePath', () => {
  it('cleans slashes', () => {
    expect(normalizePath('\\a//b/')).toBe('a/b')
    expect(normalizePath('')).toBe('/')
  })
})

describe('Vault', () => {
  it('loads the tree, skipping dot folders, and fires create', () => {
    expect(vault.getMarkdownFiles().map((f) => f.path).sort()).toEqual(['Home.md', 'Projects/Plan.md'])
    expect(vault.getAbstractFileByPath('.aether')).toBeNull()
    expect(log).toContain('create Projects/Plan.md')
    const plan = vault.getFileByPath('Projects/Plan.md')!
    expect(plan).toBeInstanceOf(TFile)
    expect([plan.basename, plan.extension, plan.parent?.path]).toEqual(['Plan', 'md', 'Projects'])
    expect(plan.stat.size).toBe(4)
  })

  it('create, read, modify', async () => {
    const f = await vault.create('Projects/New.md', 'a')
    expect(await vault.read(f)).toBe('a')
    await vault.modify(f, 'b')
    expect(await readFile(join(dir, 'Projects', 'New.md'), 'utf8')).toBe('b')
    expect(await vault.cachedRead(f)).toBe('b')
    expect(log.slice(-2)).toEqual(['create Projects/New.md', 'modify Projects/New.md'])
  })

  it('never overwrites on create or rename', async () => {
    await expect(vault.create('Home.md', 'x')).rejects.toThrow('already exists')
    await expect(vault.create('Missing/A.md', 'x')).rejects.toThrow('does not exist')
    await expect(vault.rename(vault.getFileByPath('Home.md')!, 'Projects/Plan.md')).rejects.toThrow('already exists')
    expect(await readFile(join(dir, 'Home.md'), 'utf8')).toBe('# Home')
  })

  it('renames a folder and its children', async () => {
    const folder = vault.getFolderByPath('Projects')!
    await vault.rename(folder, 'Work')
    expect(vault.getFileByPath('Work/Plan.md')?.parent).toBe(folder)
    expect(vault.getFileByPath('Projects/Plan.md')).toBeNull()
    expect(log.slice(-2)).toEqual(['rename Projects -> Work', 'rename Projects/Plan.md -> Work/Plan.md'])
  })

  it('delete needs force for a non-empty folder; trash keeps the file', async () => {
    const folder = vault.getFolderByPath('Projects')!
    await expect(vault.delete(folder)).rejects.toThrow('not empty')
    await vault.delete(folder, true)
    expect(log.slice(-2)).toEqual(['delete Projects/Plan.md', 'delete Projects'])

    await vault.trash(vault.getFileByPath('Home.md')!, false)
    expect(await readdir(join(dir, '.trash'))).toEqual(['Home.md'])
    expect(vault.getRoot().children).toEqual([])
    expect(vault.getRoot()).toBeInstanceOf(TFolder)
  })

  it('many writes to one file at once all succeed, the last one wins', async () => {
    const f = vault.getFileByPath('Home.md')!
    await Promise.all(Array.from({ length: 20 }, (_, i) => vault.modify(f, `v${i}`)))
    expect(await readFile(join(dir, 'Home.md'), 'utf8')).toBe('v19')
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('follows changes other programs make, without echoing its own writes', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await wait(30); expect(check()).toBe(true) }
    vault.startWatching()
    try {
      await writeFile(join(dir, 'Outside.md'), 'from another app')
      await until(() => !!vault.getFileByPath('Outside.md'))
      const f = vault.getFileByPath('Outside.md')!
      expect(await vault.cachedRead(f)).toBe('from another app')

      await wait(50)
      await writeFile(join(dir, 'Outside.md'), 'changed outside, longer')
      await until(() => log.includes('modify Outside.md'))
      expect(await vault.cachedRead(f)).toBe('changed outside, longer')

      await mkdir(join(dir, 'New', 'Deep'), { recursive: true })
      await writeFile(join(dir, 'New', 'Deep', 'N.md'), 'n')
      await until(() => !!vault.getFileByPath('New/Deep/N.md'))

      await rm(join(dir, 'Outside.md'))
      await until(() => !vault.getFileByPath('Outside.md'))

      const before = log.filter((l) => l === 'modify Home.md').length
      await vault.modify(vault.getFileByPath('Home.md')!, 'ours')
      await wait(500)
      expect(log.filter((l) => l === 'modify Home.md').length).toBe(before + 1)
    } finally {
      vault.stopWatching()
    }
  })

  it('process changes text in one step', async () => {
    const f = vault.getFileByPath('Home.md')!
    expect(await vault.process(f, (t) => t + '!')).toBe('# Home!')
  })
})
