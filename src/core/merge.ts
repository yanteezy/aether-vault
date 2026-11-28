/**
 * Three-way merge by lines: `base` is what both sides started from, `ours` the editor, `theirs` the disk.
 * Changes in different places are combined; changes to the same lines that differ are a conflict
 * (the caller then keeps both versions instead of choosing).
 */

interface Hunk { start: number; end: number; lines: string[] } // base[start, end) becomes lines

/** Where `next` differs from `base`, as replaced base ranges (longest common subsequence of lines). */
export function diffHunks(base: string[], next: string[]): Hunk[] {
  const n = base.length
  const m = next.length
  // shortcut: O(n·m) table; fine for notes of a few thousand lines, switch to Myers if huge files matter
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = base[i] === next[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | null = null
  const close = () => { if (open) { hunks.push(open); open = null } }
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === next[j]) { close(); i++; j++; continue }
    open ??= { start: i, end: i, lines: [] }
    if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) open.lines.push(next[j++])
    else open.end = ++i
  }
  close()
  return hunks
}

const same = (a: Hunk, b: Hunk) => a.start === b.start && a.end === b.end && a.lines.join('\n') === b.lines.join('\n')
/** Two hunks touch the same base lines; an insertion clashes with anything at or around its spot. */
const overlap = (a: Hunk, b: Hunk) =>
  a.start === a.end || b.start === b.end ? a.start <= b.end && b.start <= a.end : a.start < b.end && b.start < a.end

export function mergeText(base: string, ours: string, theirs: string): { text: string; conflict: boolean } {
  if (ours === theirs || theirs === base) return { text: ours, conflict: false }
  if (ours === base) return { text: theirs, conflict: false }
  const b = base.split('\n')
  const mine = diffHunks(b, ours.split('\n'))
  const other = diffHunks(b, theirs.split('\n'))
  const all: Hunk[] = []
  for (const h of mine) {
    const clash = other.find((o) => overlap(h, o))
    if (clash && !same(h, clash)) return { text: ours, conflict: true }
  }
  all.push(...mine, ...other.filter((o) => !mine.some((h) => same(h, o))))
  all.sort((x, y) => x.start - y.start || x.end - y.end)
  const out: string[] = []
  let at = 0
  for (const h of all) {
    out.push(...b.slice(at, h.start), ...h.lines)
    at = h.end
  }
  out.push(...b.slice(at))
  return { text: out.join('\n'), conflict: false }
}
