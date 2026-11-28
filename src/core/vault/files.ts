/** File tree objects, named as in obsidian.d.ts. Paths are vault-relative with `/`; the root is `/`. */
import type { Vault } from './vault.js'

export interface FileStats {
  ctime: number
  mtime: number
  size: number
}

export abstract class TAbstractFile {
  vault: Vault
  path = ''
  name = ''
  parent: TFolder | null

  constructor(vault: Vault, path: string, parent: TFolder | null) {
    this.vault = vault
    this.parent = parent
    this.setPath(path)
  }

  /** @internal Vault calls this on rename. */
  setPath(path: string) {
    this.path = path
    this.name = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1)
  }
}

export class TFile extends TAbstractFile {
  stat: FileStats = { ctime: 0, mtime: 0, size: 0 }
  // `declare`: an initializer would run after super() and wipe what setPath wrote
  declare basename: string
  declare extension: string

  override setPath(path: string) {
    super.setPath(path)
    const dot = this.name.lastIndexOf('.')
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name
    this.extension = dot > 0 ? this.name.slice(dot + 1) : ''
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = []

  isRoot() {
    return this.path === '/'
  }
}

/** Same rules as Obsidian's `normalizePath`: `/` separators, no doubled, leading or trailing slashes, NFC. */
export function normalizePath(path: string): string {
  const p = path.replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, '').normalize('NFC')
  return p === '' ? '/' : p
}
