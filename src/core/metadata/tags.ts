import type { CachedMetadata } from './parse.js'

/** Tags from the text and from frontmatter `tags` / `tag`, each with `#`, like Obsidian's `getAllTags`. */
export function getAllTags(cache: CachedMetadata): string[] {
  const out = (cache.tags ?? []).map((t) => t.tag)
  const fm = cache.frontmatter
  for (const key of ['tags', 'tag']) {
    const v = fm?.[key]
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []
    for (const t of list) if (t && typeof t === 'string') out.push(t.startsWith('#') ? t : `#${t}`)
  }
  return out
}

type Frontmatter = Record<string, unknown> | null | undefined

/** A frontmatter value as a list of strings (`a, b`, `[a, b]` or one value); null when missing. */
export function parseFrontMatterStringArray(fm: Frontmatter, key: string | RegExp): string[] | null {
  const k = fm && Object.keys(fm).find((n) => (typeof key === 'string' ? n.toLowerCase() === key.toLowerCase() : key.test(n)))
  const v = k ? fm![k] : undefined
  if (v == null) return null
  const list = Array.isArray(v) ? v : String(v).split(',')
  const out = list.filter((x) => x != null && x !== '').map((x) => String(x).trim()).filter(Boolean)
  return out.length ? out : null
}
export const parseFrontMatterEntry = (fm: Frontmatter, key: string | RegExp) => {
  const k = fm && Object.keys(fm).find((n) => (typeof key === 'string' ? n === key : key.test(n)))
  return k ? fm![k] : null
}
export const parseFrontMatterAliases = (fm: Frontmatter) => parseFrontMatterStringArray(fm, /^alias(es)?$/i)
export const parseFrontMatterTags = (fm: Frontmatter) =>
  parseFrontMatterStringArray(fm, /^tags?$/i)?.flatMap((t) => t.split(/\s+/)).map((t) => (t.startsWith('#') ? t : `#${t}`)) ?? null
