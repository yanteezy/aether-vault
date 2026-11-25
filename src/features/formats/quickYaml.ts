/**
 * Frontmatter as Aether writes it, read without the full YAML parser (which took most of the 0.3 s that opening
 * 10 000 notes spent parsing). Only flat `key: value` lines and lists of plain values are understood; for anything
 * else it returns undefined and the caller uses the real parser, so the result is always what `yaml` would give.
 */
const KEY = /^([A-Za-z][\w-]*):(?: (.*))?$/
const ITEM = /^(?: {2})?- (.*)$/
/** A plain YAML value that is just text: no quote, flow, anchor or other indicator in front, no comment, no tab. */
const TEXT = /^[^\s\-?:,[\]{}#&*!|>'"%@`~.+\d](?:(?!: | #)[^\t])*$/u
const INT = /^-?[1-9]\d{0,14}$|^0$/
/** Written by Aether as the `updated` time; a YAML 1.2 string. */
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/

function scalar(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (INT.test(raw)) return Number(raw)
  if (ISO.test(raw)) return raw
  // null / True / TRUE and the like have other meanings in YAML
  if (/^(?:null|true|false|nan|inf)$/i.test(raw) || !TEXT.test(raw) || raw.endsWith(':') || raw !== raw.trimEnd()) return undefined
  return raw
}

export function quickYaml(source: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  let list: unknown[] | undefined
  for (const line of source.split('\n')) {
    const item = ITEM.exec(line)
    if (item) {
      const value = scalar(item[1])
      if (!list || value === undefined) return undefined
      list.push(value)
      continue
    }
    const pair = KEY.exec(line)
    // a key without a value must start a list; a repeated key is an error for the real parser
    if (!pair || pair[1] in out || (list && !list.length)) return undefined
    if (pair[2] === undefined) {
      out[pair[1]] = list = []
      continue
    }
    list = undefined
    const value = scalar(pair[2])
    if (value === undefined) return undefined
    out[pair[1]] = value
  }
  return list && !list.length ? undefined : out
}
