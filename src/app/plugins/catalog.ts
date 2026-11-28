/**
 * Obsidian's community plugin catalog: the list lives in obsidianmd/obsidian-releases, the files in each
 * plugin's GitHub release named after the version in its manifest — the same places Obsidian downloads from.
 */
import type { App } from '../app.js'
import type { PluginManifest } from '../component.js'
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from '../request.js'

export interface CatalogEntry { id: string; name: string; author: string; description: string; repo: string }
export type Fetch = (req: RequestUrlParam) => Promise<RequestUrlResponse>

const CATALOG = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json'
const defaultFetch: Fetch = (req) => requestUrl(req)

/** A plugin id becomes a folder name: only plain names, never a path. */
export const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i
const SAFE_REPO = /^[\w.-]+\/[\w.-]+$/
const SAFE_VERSION = /^[\w.+-]+$/

export async function fetchCatalog(fetch: Fetch = defaultFetch): Promise<CatalogEntry[]> {
  const list = (await fetch({ url: CATALOG })).json
  if (!Array.isArray(list)) throw new Error('Каталог плагінів має неочікуваний формат.')
  return list.filter((e): e is CatalogEntry =>
    !!e && typeof e.id === 'string' && SAFE_ID.test(e.id) && typeof e.repo === 'string' && SAFE_REPO.test(e.repo) && typeof e.name === 'string')
}

/** Simple ranking: name matches first, then author / description. */
export function searchCatalog(list: CatalogEntry[], query: string, limit = 50) {
  const q = query.trim().toLowerCase()
  if (!q) return list.slice(0, limit)
  const score = (e: CatalogEntry) => (e.name.toLowerCase().includes(q) ? 0 : e.author?.toLowerCase().includes(q) ? 1 : e.description?.toLowerCase().includes(q) ? 2 : 3)
  return list.map((e) => [score(e), e] as const).filter(([s]) => s < 3).sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, e]) => e)
}

/**
 * Downloads manifest.json, main.js and styles.css (if the release has it) into `<configDir>/plugins/<id>/`.
 * Does not enable the plugin: that stays the user's choice in settings.
 */
export async function installPlugin(app: App, entry: CatalogEntry, fetch: Fetch = defaultFetch): Promise<PluginManifest> {
  if (!SAFE_ID.test(entry.id) || !SAFE_REPO.test(entry.repo)) throw new Error('Небезпечна назва плагіна в каталозі.')
  const manifest = (await fetch({ url: `https://raw.githubusercontent.com/${entry.repo}/HEAD/manifest.json` })).json as PluginManifest
  if (manifest?.id !== entry.id) throw new Error(`Маніфест плагіна має інший id («${manifest?.id}»).`)
  if (typeof manifest.version !== 'string' || !SAFE_VERSION.test(manifest.version)) throw new Error('Маніфест плагіна має неочікувану версію.')
  const release = `https://github.com/${entry.repo}/releases/download/${manifest.version}`
  const [mainJs, manifestJson, styles] = await Promise.all([
    fetch({ url: `${release}/main.js` }),
    fetch({ url: `${release}/manifest.json` }),
    fetch({ url: `${release}/styles.css`, throw: false }),
  ])
  if (mainJs.status >= 400 || manifestJson.status >= 400) throw new Error('У релізі плагіна немає потрібних файлів.')
  let released: { id?: unknown }
  try { released = JSON.parse(manifestJson.text) } catch { throw new Error('manifest.json у релізі пошкоджено.') }
  if (released.id !== entry.id) throw new Error(`Маніфест у релізі має інший id («${String(released.id)}»).`)
  const dir = `${app.vault.configDir}/plugins/${entry.id}`
  const adapter = app.vault.adapter
  await adapter.mkdir(dir)
  await adapter.write(`${dir}/main.js`, mainJs.text)
  await adapter.write(`${dir}/manifest.json`, manifestJson.text)
  if (styles.status < 400) await adapter.write(`${dir}/styles.css`, styles.text)
  await app.plugins.loadManifests()
  return app.plugins.manifests[entry.id]
}
