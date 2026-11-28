/**
 * Obsidian's `FileManager`: rename with link updates in other notes, frontmatter edits, link text.
 * Lives in core: it needs only the vault and the metadata cache.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { MetadataCache } from '../metadata/metadataCache.js'
import type { LinkCache } from '../metadata/parse.js'
import { TFile, type TAbstractFile, type TFolder } from './files.js'
import type { Vault } from './vault.js'

/** One link to rewrite; `target` is the same TFile object before and after the rename. */
interface Edit { link: LinkCache; embed: boolean; target: TFile; subpath: string }

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/
const subpathOf = (link: string) => (link.includes('#') ? link.slice(link.indexOf('#')) : '')

export class FileManager {
  /** Runs before a rename rewrites other notes, so open editors save first (their text would win otherwise). */
  beforeRewrite: () => Promise<void> = async () => {}

  constructor(private readonly vault: Vault, private readonly metadataCache: MetadataCache) {}

  /** shortcut: new notes always go to the vault root; Obsidian has a setting for this. */
  getNewFileParent(_sourcePath: string, _newFilePath?: string): TFolder {
    return this.vault.getRoot()
  }

  /** `[[Note]]`, or `[[folder/Note]]` when the name alone would find another file; `![[…]]` for non-notes. */
  generateMarkdownLink(file: TFile, sourcePath: string, subpath = '', alias = ''): string {
    const text = this.metadataCache.fileToLinktext(file, sourcePath, true)
    return `${file.extension === 'md' ? '' : '!'}[[${text}${subpath}${alias ? `|${alias}` : ''}]]`
  }

  /** Renames or moves a file or folder and rewrites every link that pointed into it. */
  async renameFile(file: TAbstractFile, newPath: string) {
    await this.beforeRewrite()
    await this.metadataCache.idle()
    const targets = new Set<TFile>(file instanceof TFile ? [file] : this.vault.getFiles().filter((f) => f.path.startsWith(`${file.path}/`)))

    // find the links before anything moves: afterwards the old names resolve to nothing
    const edits = new Map<TFile, Edit[]>()
    for (const source of this.vault.getMarkdownFiles()) {
      const cache = this.metadataCache.getFileCache(source)
      for (const [list, embed] of [[cache?.links, false], [cache?.embeds, true]] as const) {
        for (const link of list ?? []) {
          const target = this.metadataCache.getFirstLinkpathDest(link.link, source.path)
          if (target && targets.has(target)) edits.set(source, [...(edits.get(source) ?? []), { link, embed, target, subpath: subpathOf(link.link) }])
        }
      }
    }

    await this.vault.rename(file, newPath)

    for (const [source, list] of edits) {
      await this.vault.process(source, (text) => {
        // from the end, so earlier offsets stay valid; a span that no longer matches is left alone
        for (const e of list.sort((a, b) => b.link.position.start.offset - a.link.position.start.offset)) {
          const { start, end } = e.link.position
          if (text.slice(start.offset, end.offset) !== e.link.original) continue
          text = text.slice(0, start.offset) + this.linkText(e, source.path) + text.slice(end.offset)
        }
        return text
      })
    }
  }

  /** Reads the YAML at the top, lets `fn` change it, writes it back. The note's body stays as it was. */
  async processFrontMatter(file: TFile, fn: (frontmatter: Record<string, any>) => void) {
    await this.vault.process(file, (text) => {
      const m = FRONTMATTER.exec(text)
      const data = m ? (parseYaml(m[1]) ?? {}) : {}
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter is not a YAML map')
      fn(data)
      const body = m ? text.slice(m[0].length) : text
      if (!Object.keys(data).length) return body
      return `---\n${stringifyYaml(data)}---\n${body}`
    })
  }

  async trashFile(file: TAbstractFile) {
    return this.vault.trash(file, true)
  }

  private linkText(e: Edit, sourcePath: string) {
    const bang = e.embed ? '!' : ''
    if (e.link.original.startsWith(`${bang}[[`)) {
      const alias = e.link.original.includes('|') ? `|${e.link.displayText}` : ''
      return `${bang}[[${this.metadataCache.fileToLinktext(e.target, sourcePath, true)}${e.subpath}${alias}]]`
    }
    return `${bang}[${e.link.displayText ?? ''}](${encodeURI(e.target.path)}${e.subpath})`
  }
}
