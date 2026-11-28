/**
 * Tags made by hand in the sidebar (not only the ones found in notes):
 * - kept per vault in `<configDir>/tags.json` — they show only in that vault;
 * - «Зберігати всюди» moves a tag to the app's own list (localStorage) — it then shows in every vault.
 */
import type { App } from './app.js'

const GLOBAL_KEY = 'aether-global-tags'
const fileOf = (app: App) => `${app.vault.configDir}/tags.json`

/** `#name` with letters, digits, _ / - (Obsidian's tag rules); null when it is not a tag. */
export function normalizeTag(input: string): string | null {
  const name = input.trim().replace(/^#+/, '')
  if (!name || /^\d+$/.test(name) || !/^[\p{L}\p{N}_/-]+$/u.test(name)) return null
  return `#${name}`
}

export class TagStore {
  private local: string[] = []

  constructor(private readonly app: App) {}

  async load() {
    try {
      const data = JSON.parse(await this.app.vault.adapter.read(fileOf(this.app)))
      this.local = Array.isArray(data?.tags) ? data.tags.filter((t: unknown) => typeof t === 'string' && normalizeTag(t)) : []
    } catch {
      this.local = [] // no file yet
    }
  }

  vaultTags() { return [...this.local] }

  globalTags(): string[] {
    try {
      const list = JSON.parse(localStorage.getItem(GLOBAL_KEY) ?? '[]')
      return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : []
    } catch { return [] }
  }

  isGlobal(tag: string) { return this.globalTags().some((t) => t.toLowerCase() === tag.toLowerCase()) }

  async add(tag: string) {
    if (this.local.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    this.local.push(tag)
    await this.save()
  }

  /** On: the tag shows in every vault. Off: it stays in this vault only. */
  async setGlobal(tag: string, on: boolean) {
    const rest = this.globalTags().filter((t) => t.toLowerCase() !== tag.toLowerCase())
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(on ? [...rest, tag] : rest))
    if (!on) await this.add(tag) // keep it here when it stops being everywhere
    else this.changed()
  }

  /** Out of this vault's list and the app-wide one. Returns which lists had it, for `restore`. */
  async forget(tag: string) {
    const lower = tag.toLowerCase()
    const had = { local: this.local.some((t) => t.toLowerCase() === lower), global: this.isGlobal(tag) }
    this.local = this.local.filter((t) => t.toLowerCase() !== lower)
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(this.globalTags().filter((t) => t.toLowerCase() !== lower)))
    await this.save()
    return had
  }

  /** Undo of `forget`. */
  async restore(tag: string, had: { local: boolean; global: boolean }) {
    if (had.local) await this.add(tag)
    if (had.global) await this.setGlobal(tag, true)
  }

  private async save() {
    await this.app.vault.adapter.mkdir(this.app.vault.configDir)
    await this.app.vault.adapter.write(fileOf(this.app), JSON.stringify({ tags: this.local }, null, 2))
    this.changed()
  }

  private changed() {
    window.dispatchEvent(new CustomEvent('aether:tags'))
  }
}
