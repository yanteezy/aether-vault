import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSystemAdapter } from '../vault/adapter.js'
import { Vault } from '../vault/vault.js'
import { MetadataCache } from './metadataCache.js'
import { parseMarkdown } from './parse.js'

describe('parseMarkdown', () => {
  const text = [
    '---',
    'tags: [work]',
    'status: draft',
    '---',
    '# Title',
    'See [[Plan|the plan]] and ![[pic.png]], #idea #123.',
    '[doc](Docs/Spec.md) [web](https://x.com) `[[not a link]] #nottag`',
    '',
    '```',
    '# not a heading [[Nope]]',
    '```',
    '- item #list/sub',
  ].join('\n')
  const m = parseMarkdown(text)

  it('reads frontmatter', () => {
    expect(m.frontmatter).toEqual({ tags: ['work'], status: 'draft' })
    expect(m.frontmatterPosition?.end.line).toBe(3)
  })
  it('finds links, embeds, tags and headings outside code', () => {
    expect(m.links?.map((l) => [l.link, l.displayText])).toEqual([['Plan', 'the plan'], ['Docs/Spec.md', 'doc']])
    expect(m.embeds?.map((l) => l.link)).toEqual(['pic.png'])
    expect(m.tags?.map((t) => t.tag)).toEqual(['#idea', '#list/sub'])
    expect(m.headings).toMatchObject([{ heading: 'Title', level: 1 }])
  })
  it('gives exact positions', () => {
    const link = m.links![0]
    expect(text.slice(link.position.start.offset, link.position.end.offset)).toBe('[[Plan|the plan]]')
    expect(link.position.start).toMatchObject({ line: 5, col: 4 })
  })
  it('splits sections', () => {
    expect(m.sections?.map((s) => s.type)).toEqual(['yaml', 'heading', 'paragraph', 'code', 'list'])
  })
  it('survives broken YAML', () => {
    expect(parseMarkdown('---\na: [\n---\ntext').frontmatter).toBeUndefined()
  })
})

describe('MetadataCache', () => {
  let dir: string
  afterEach(() => rm(dir, { recursive: true, force: true }))

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), 'meta-'))
    await mkdir(join(dir, 'A'))
    await mkdir(join(dir, 'B'))
    await writeFile(join(dir, 'A', 'Note.md'), 'a')
    await writeFile(join(dir, 'B', 'Note.md'), 'b')
    await writeFile(join(dir, 'A', 'Home.md'), '[[Note]] [[Note]] [[Ghost]]')
    const vault = new Vault(new FileSystemAdapter(dir))
    const cache = new MetadataCache(vault)
    const events: string[] = []
    cache.on('changed', (f) => events.push(`changed ${f.path}`))
    cache.on('resolve', (f) => events.push(`resolve ${f.path}`))
    cache.on('resolved', () => events.push('resolved'))
    cache.on('deleted', (f) => events.push(`deleted ${f.path}`))
    await vault.load()
    await cache.idle()
    return { vault, cache, events }
  }

  it('resolves links, preferring the same folder', async () => {
    const { cache, events } = await setup()
    expect(cache.resolvedLinks['A/Home.md']).toEqual({ 'A/Note.md': 2 })
    expect(cache.unresolvedLinks['A/Home.md']).toEqual({ Ghost: 1 })
    expect(cache.getFirstLinkpathDest('B/Note', 'A/Home.md')?.path).toBe('B/Note.md')
    expect(events).toContain('changed A/Home.md')
    expect(events.at(-1)).toBe('resolved')
  })

  it('updates on create, modify, rename and delete', async () => {
    const { vault, cache, events } = await setup()
    await vault.create('Ghost.md', '#new')
    await cache.idle()
    expect(cache.resolvedLinks['A/Home.md']).toEqual({ 'A/Note.md': 2, 'Ghost.md': 1 })

    const home = vault.getFileByPath('A/Home.md')!
    await vault.modify(home, '[[B/Note]]')
    await cache.idle()
    expect(cache.getFileCache(home)?.links?.[0].link).toBe('B/Note')
    expect(cache.resolvedLinks['A/Home.md']).toEqual({ 'B/Note.md': 1 })

    await vault.rename(vault.getFolderByPath('B')!, 'C')
    await cache.idle()
    expect(cache.getCache('C/Note.md')).not.toBeNull()
    // the link text is not rewritten (that is FileManager's job), so the old path no longer resolves
    expect(cache.unresolvedLinks['A/Home.md']).toEqual({ 'B/Note': 1 })

    await vault.modify(home, '[[Note]]')
    await vault.delete(vault.getFileByPath('A/Note.md')!)
    await cache.idle()
    expect(events).toContain('deleted A/Note.md')
    expect(cache.resolvedLinks['A/Home.md']).toEqual({ 'C/Note.md': 1 }) // falls back to the other Note
  })
})
