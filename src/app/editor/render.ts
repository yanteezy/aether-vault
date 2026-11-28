/**
 * Reading view rendering, as Obsidian's `MarkdownRenderer`: Markdown → sanitized HTML, one `<div>` per block,
 * then code block processors and post-processors from plugins run on those divs.
 * DOM: `.markdown-preview-view.markdown-rendered`, links `a.internal-link[data-href]`, tags `a.tag`.
 */
import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import type { TFile } from '../../core/vault/files.js'
import type { App } from '../app.js'
import { Component } from '../component.js'

export interface MarkdownPostProcessorContext {
  docId: string
  sourcePath: string
  frontmatter: Record<string, unknown> | null | undefined
  addChild(child: Component): void
  getSectionInfo(el: HTMLElement): null
}
export type MarkdownPostProcessor = ((el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void) & { sortOrder?: number }
export type CodeBlockProcessor = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void

/** A piece of rendered content with its own life cycle (Obsidian's `MarkdownRenderChild`). */
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super()
  }
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const TAG = /(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let docCounter = 0

function markedFor(app: App, sourcePath: string) {
  const m = new Marked({ gfm: true, breaks: false })
  m.use({
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start: (src: string) => src.search(/!?\[\[/),
      tokenizer(src: string) {
        const match = /^(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(src)
        if (match) return { type: 'wikilink', raw: match[0], embed: !!match[1], target: match[2].trim(), alias: match[3] }
      },
      renderer(token: Tokens.Generic) {
        const { embed, target, alias } = token as unknown as { embed: boolean; target: string; alias?: string }
        const file = app.metadataCache.getFirstLinkpathDest(target.split('#')[0], sourcePath)
        if (embed && file && IMAGE.test(file.path)) {
          // the <img> is added after sanitizing: file: URLs would not pass DOMPurify, and we trust only our own
          return `<span class="internal-embed image-embed" data-embed-path="${escapeHtml(file.path)}" data-alt="${escapeHtml(alias ?? file.basename)}"></span>`
        }
        const text = alias ?? target
        const cls = `internal-link${file ? '' : ' is-unresolved'}${embed ? ' internal-embed' : ''}`
        return `<a class="${cls}" data-href="${escapeHtml(target)}" href="${escapeHtml(target)}">${escapeHtml(text)}</a>`
      },
    }],
  })
  return m
}

/** `#tag` in text (not in code or links) becomes `a.tag`, as in Obsidian. */
function linkTags(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue?.includes('#')) nodes.push(n as Text)
  for (const node of nodes) {
    const frag = document.createDocumentFragment()
    let last = 0
    const text = node.nodeValue!
    for (const m of text.matchAll(TAG)) {
      const at = m.index + m[1].length
      frag.append(text.slice(last, at))
      frag.append(createEl('a', { cls: 'tag', text: `#${m[2]}`, attr: { href: `#${m[2]}` } }))
      last = at + m[2].length + 1
    }
    frag.append(text.slice(last))
    node.replaceWith(frag)
  }
}

export const MarkdownRenderer = {
  /** Renders `markdown` into `el`. Plugin processors may add children to `component`. */
  async render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component) {
    const file = app.vault.getFileByPath(sourcePath)
    const frontmatter = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined
    const body = markdown.replace(FRONTMATTER, '')
    const html = await markedFor(app, sourcePath).parse(body)
    // a note is untrusted: with Node in the page, a stray <img onerror> would run with full access
    const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form'] })
    const tpl = document.createElement('template')
    tpl.innerHTML = clean
    for (const span of tpl.content.querySelectorAll<HTMLElement>('span[data-embed-path]')) {
      const img = app.vault.getFileByPath(span.dataset.embedPath ?? '')
      if (img) span.createEl('img', { attr: { src: app.vault.getResourcePath(img), alt: span.dataset.alt ?? '' } })
    }

    const ctx: MarkdownPostProcessorContext = {
      docId: `doc-${++docCounter}`,
      sourcePath,
      frontmatter,
      addChild: (child) => component.addChild(child),
      getSectionInfo: () => null,
    }
    const blocks: HTMLElement[] = []
    for (const node of [...tpl.content.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && !node.nodeValue?.trim()) continue
      const div = el.createDiv()
      div.appendChild(node)
      linkTags(div)
      blocks.push(div)
    }

    for (const div of blocks) {
      const code = div.querySelector<HTMLElement>(':scope > pre > code[class*="language-"]')
      const lang = code?.className.match(/language-(\S+)/)?.[1]
      const handler = lang && app.codeBlockProcessors.get(lang)
      if (code && lang && handler) {
        const source = code.textContent ?? ''
        div.empty()
        const box = div.createDiv(`block-language-${lang}`)
        try { await handler(source, box, ctx) } catch (e) { console.error(e) }
      }
    }
    const processors = [...app.markdownPostProcessors].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    for (const div of blocks) {
      for (const pp of processors) {
        try { await pp(div, ctx) } catch (e) { console.error(e) }
      }
    }
  },

  /** @deprecated in Obsidian; same as `render` without `app`. */
  renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, component: Component) {
    return MarkdownRenderer.render((globalThis as unknown as { app: App }).app, markdown, el, sourcePath, component)
  },
}

/** Reading view for one note. */
export class MarkdownPreview extends Component {
  readonly containerEl: HTMLElement
  private content = new Component()

  constructor(private readonly app: App, parent: HTMLElement, private readonly openLink: (link: string, newTab: boolean) => void) {
    super()
    this.containerEl = parent.createDiv({ cls: 'markdown-preview-view markdown-rendered is-readable-line-width', attr: { tabindex: '0' } })
    this.containerEl.addEventListener('click', (e) => this.onClick(e))
  }

  async render(text: string, file: TFile | null) {
    this.content.unload()
    this.content = new Component()
    this.content.load()
    const sizer = createDiv('markdown-preview-sizer markdown-preview-section')
    await MarkdownRenderer.render(this.app, text, sizer, file?.path ?? '', this.content)
    this.containerEl.empty()
    this.containerEl.appendChild(sizer)
  }

  onunload() {
    this.content.unload()
  }

  /** Every link click is handled here: the window itself must never navigate away. */
  private onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const newTab = e.ctrlKey || e.metaKey
    if (a.hasClass('internal-link')) this.openLink(a.dataset.href ?? '', newTab)
    else if (a.hasClass('tag')) this.app.searchFor(a.textContent ?? '')
    else if (/^https?:|^mailto:/i.test(a.getAttribute('href') ?? '')) {
      void import('electron').then(({ shell }) => shell.openExternal(a.href)).catch(() => window.open(a.href))
    }
  }
}
