// Verifies text contrast on Liquid Glass: composites glass fill over a backdrop, then text over that.
// Usage: node scripts/glass-contrast.mjs
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a))
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const fills = { regular: [[28, 30, 42], 0.72], menu: [[28, 30, 42], 0.82], solid: [[38, 40, 52], 1] }
const backdrops = { 'app #151a26': [21, 26, 38], 'blob #3b5b8f': [59, 91, 143], 'mid grey #808080': [128, 128, 128], 'white': [255, 255, 255] }
const texts = { 'text-normal #f5f5f7': [[245, 245, 247], 1], 'text-muted .7': [[235, 235, 245], 0.7], 'text-faint .62': [[235, 235, 245], 0.62] }
for (const [fn, [fc, fa]] of Object.entries(fills)) for (const [bn, b] of Object.entries(backdrops)) {
  const glass = over(fc, fa, b)
  console.log(fn.padEnd(8), bn.padEnd(18), Object.entries(texts).map(([tn, [tc, ta]]) => `${tn.split(' ')[0]} ${cr(over(tc, ta, glass), glass).toFixed(2)}`).join('  '))
}
