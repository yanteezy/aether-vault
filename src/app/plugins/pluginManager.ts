/**
 * Community plugins, laid out as in Obsidian: `<configDir>/plugins/<id>/{manifest.json, main.js, styles.css, data.json}`,
 * the enabled list in `<configDir>/community-plugins.json`.
 * `main.js` is CommonJS: it gets a `require` that returns our `obsidian` module, the app's own CodeMirror,
 * and Node / Electron for everything else.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { App } from '../app.js'
import type { Plugin, PluginManifest } from '../component.js'
import { Notice } from '../ui.js'

const nodeRequire = createRequire(join(process.cwd(), 'plugin-host.js'))

export class PluginManager {
  manifests: Record<string, PluginManifest> = {}
  /** Loaded plugins by id; Obsidian plugins read `app.plugins.plugins[id]`. */
  plugins: Record<string, Plugin> = {}
  enabledPlugins = new Set<string>()
  private readonly styles = new Map<string, HTMLStyleElement>()

  constructor(
    private readonly app: App,
    private readonly modules: () => Record<string, unknown>,
  ) {}

  private get dir() { return `${this.app.vault.configDir}/plugins` }
  private get listPath() { return `${this.app.vault.configDir}/community-plugins.json` }

  /** Names plugins read from `obsidian` that we do not have yet: the to-do list for compatibility. */
  readonly missingApi = new Set<string>()
  private obsidianProxy: object | undefined

  readonly requireFor = (name: string): unknown => {
    if (name === 'obsidian') return (this.obsidianProxy ??= this.watchMissing(this.modules().obsidian as object))
    return this.modules()[name] ?? nodeRequire(name)
  }

  private watchMissing(mod: object) {
    return new Proxy(mod, {
      get: (target, key) => {
        if (typeof key === 'string' && !(key in target) && key !== '__esModule' && key !== 'default' && key !== 'then' && !this.missingApi.has(key)) {
          this.missingApi.add(key)
          console.warn(`obsidian.${key} is not implemented yet`)
        }
        return Reflect.get(target, key)
      },
    })
  }

  async loadManifests() {
    this.manifests = {}
    const a = this.app.vault.adapter
    if (!(await a.exists(this.dir))) return
    for (const folder of (await a.list(this.dir)).folders) {
      try {
        const m = JSON.parse(await a.read(`${folder}/manifest.json`)) as PluginManifest
        if ([m.id, m.name, m.version].every((v) => typeof v === 'string' && v)) this.manifests[m.id] = { ...m, dir: folder }
        else console.warn(`Plugin manifest without id, name or version: ${folder}`)
      } catch (e) {
        console.warn(`Cannot read plugin manifest in ${folder}`, e)
      }
    }
  }

  /** Ids listed as enabled; an unreadable file means none, never a crash. */
  async readEnabledList(): Promise<string[]> {
    try {
      const list = JSON.parse(await this.app.vault.adapter.read(this.listPath))
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  private async saveEnabledList() {
    await this.app.vault.adapter.mkdir(this.app.vault.configDir)
    await this.app.vault.adapter.write(this.listPath, JSON.stringify([...this.enabledPlugins], null, 2))
  }

  /** Loads every plugin from the enabled list. Call only after the user trusted this vault. */
  async loadEnabled() {
    for (const id of await this.readEnabledList()) {
      this.enabledPlugins.add(id)
      if (this.manifests[id]) await this.loadPlugin(id)
    }
  }

  async enablePlugin(id: string) {
    const ok = await this.loadPlugin(id)
    if (ok) {
      this.enabledPlugins.add(id)
      await this.saveEnabledList()
    }
    return ok
  }

  async disablePlugin(id: string) {
    this.unloadPlugin(id)
    this.enabledPlugins.delete(id)
    await this.saveEnabledList()
  }

  /** Turns the plugin off and moves its folder to the vault's `.trash`; returns how `restorePlugin` puts it back. */
  async uninstallPlugin(id: string) {
    const m = this.manifests[id]
    if (!m) return null
    const wasEnabled = this.enabledPlugins.has(id) || !!this.plugins[id]
    if (wasEnabled) await this.disablePlugin(id)
    const trashed = await this.app.vault.adapter.trashLocal(m.dir!)
    delete this.manifests[id]
    return { id, dir: m.dir!, trashed, wasEnabled }
  }

  /** Undo of `uninstallPlugin`: the folder comes back from `.trash`, and the plugin is on again if it was. */
  async restorePlugin(r: { id: string; dir: string; trashed: string; wasEnabled: boolean }) {
    await this.app.vault.adapter.rename(r.trashed, r.dir)
    await this.loadManifests()
    if (r.wasEnabled) await this.enablePlugin(r.id)
  }

  async loadPlugin(id: string): Promise<boolean> {
    const m = this.manifests[id]
    if (!m) return false
    if (this.plugins[id]) return true
    const a = this.app.vault.adapter
    try {
      const code = await a.read(`${m.dir}/main.js`)
      const module = { exports: {} as any }
      // the plugin's own code, run the way Obsidian runs it: a CommonJS function
      new Function('require', 'module', 'exports', `${code}\n//# sourceURL=plugin:${id}/main.js`)(this.requireFor, module, module.exports)
      const PluginClass = module.exports.default ?? module.exports
      if (typeof PluginClass !== 'function') throw new Error('main.js не експортує клас плагіна')
      if (await a.exists(`${m.dir}/styles.css`)) {
        const style = document.head.createEl('style', { attr: { 'data-plugin': id } })
        style.textContent = await a.read(`${m.dir}/styles.css`)
        this.styles.set(id, style)
      }
      const plugin: Plugin = new PluginClass(this.app, m)
      this.plugins[id] = plugin
      await plugin.load()
      return true
    } catch (e) {
      console.error(`Plugin ${id} failed to load`, e)
      new Notice(`Плагін «${m.name}» не завантажився: ${(e as Error).message}`, 8000)
      this.unloadPlugin(id)
      return false
    }
  }

  unloadPlugin(id: string) {
    const plugin = this.plugins[id]
    delete this.plugins[id]
    try { plugin?.unload() } catch (e) { console.error(e) }
    this.styles.get(id)?.remove()
    this.styles.delete(id)
  }

  getPlugin(id: string): Plugin | null {
    return this.plugins[id] ?? null
  }

  unloadAll() {
    for (const id of Object.keys(this.plugins)) this.unloadPlugin(id)
  }
}
