import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MetadataCache } from '../metadata/metadataCache.js'
import { FileSystemAdapter } from './adapter.js'
import { FileManager } from './fileManager.js'
import { Vault } from './vault.js'

let dir: string
let vault: Vault
let fm: FileManager
const read = (p: string) => readFile(join(dir, p), 'utf8')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fm-'))
  await mkdir(join(dir, 'Docs'))
  await writeFile(join(dir, 'Plan.md'), 'plan')
  await writeFile(join(dir, 'Docs', 'Spec.md'), 'spec')
  await writeFile(join(dir, 'Docs', 'pic.png'), 'png')
  await writeFile(join(dir, 'Home.md'), 'A [[Plan]], B [[Plan#Goals|goals]], C [p](Plan.md), D ![[pic.png]], E [[Spec]], F [[Other]]')
  vault = new Vault(new FileSystemAdapter(dir))
  const cache = new MetadataCache(vault)
  fm = new FileManager(vault, cache)
  await vault.load()
  await cache.idle()
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('FileManager', () => {
  it('renames a note and rewrites links to it, keeping headings and aliases', async () => {
    await fm.renameFile(vault.getFileByPath('Plan.md')!, 'Roadmap.md')
    expect(await read('Home.md')).toBe('A [[Roadmap]], B [[Roadmap#Goals|goals]], C [p](Roadmap.md), D ![[pic.png]], E [[Spec]], F [[Other]]')
  })

  it('moves a folder and keeps links pointing into it', async () => {
    await vault.createFolder('Archive')
    await fm.renameFile(vault.getFolderByPath('Docs')!, 'Archive/Docs')
    // names stay unique, so the short link text is still enough
    expect(await read('Home.md')).toContain('![[pic.png]], E [[Spec]]')
    await vault.create('Spec.md', 'another spec')
    expect(fm.generateMarkdownLink(vault.getFileByPath('Archive/Docs/Spec.md')!, 'Home.md')).toBe('[[Archive/Docs/Spec]]')
  })

  it('edits frontmatter and keeps the body', async () => {
    const plan = vault.getFileByPath('Plan.md')!
    await fm.processFrontMatter(plan, (f) => { f.status = 'draft'; f.tags = ['a'] })
    expect(await read('Plan.md')).toBe('---\nstatus: draft\ntags:\n  - a\n---\nplan')
    await fm.processFrontMatter(plan, (f) => { delete f.status; delete f.tags })
    expect(await read('Plan.md')).toBe('plan')
  })
})
