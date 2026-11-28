// @vitest-environment jsdom
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../app.js'
import { installDom } from '../dom.js'
import type { RequestUrlParam } from '../request.js'
import { fetchCatalog, installPlugin, searchCatalog, type CatalogEntry } from './catalog.js'

installDom(window)

/** A fake web: url → body (404 when missing). */
const web = (pages: Record<string, string>) => async (req: RequestUrlParam) => {
  const text = pages[req.url]
  if (text === undefined && req.throw !== false) throw new Error(`404 ${req.url}`)
  return { status: text === undefined ? 404 : 200, headers: {}, arrayBuffer: new ArrayBuffer(0), text: text ?? '', get json() { return JSON.parse(text ?? 'null') } }
}

const entry: CatalogEntry = { id: 'hello', name: 'Hello', author: 'Ann', description: 'Says hi', repo: 'ann/hello' }
const manifest = JSON.stringify({ id: 'hello', name: 'Hello', version: '1.2.0' })

let dir: string
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

describe('community plugin catalog', () => {
  it('drops entries with unsafe ids or repos, and searches by name first', async () => {
    const list = await fetchCatalog(web({
      'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json': JSON.stringify([
        entry, { ...entry, id: '../evil' }, { ...entry, id: 'x', repo: 'no-slash' },
        { id: 'other', name: 'Other', author: 'Hello Corp', description: '', repo: 'h/o' },
      ]),
    }))
    expect(list.map((e) => e.id)).toEqual(['hello', 'other'])
    expect(searchCatalog(list, 'hello').map((e) => e.id)).toEqual(['hello', 'other'])
  })

  it('installs the release files into the plugins folder, refuses a mismatched manifest', async () => {
    dir = await mkdtemp(join(tmpdir(), 'catalog-'))
    const app = new App(dir)
    await app.start(document.body)
    const release = 'https://github.com/ann/hello/releases/download/1.2.0'
    const pages = {
      'https://raw.githubusercontent.com/ann/hello/HEAD/manifest.json': manifest,
      [`${release}/main.js`]: 'module.exports = class {}',
      [`${release}/manifest.json`]: manifest,
    }
    const m = await installPlugin(app, entry, web(pages))
    expect(m).toMatchObject({ id: 'hello', version: '1.2.0' })
    expect((await readdir(join(dir, '.aether/plugins/hello'))).sort()).toEqual(['main.js', 'manifest.json']) // no styles.css in this release
    expect(await readFile(join(dir, '.aether/plugins/hello/main.js'), 'utf8')).toBe('module.exports = class {}')
    expect(app.plugins.plugins.hello).toBeUndefined() // installed, not enabled

    await expect(installPlugin(app, { ...entry, id: '../evil' }, web(pages))).rejects.toThrow('Небезпечна')
    await expect(installPlugin(app, { ...entry, id: 'other' }, web(pages))).rejects.toThrow('інший id')
    app.vault.stopWatching()
  })
})
