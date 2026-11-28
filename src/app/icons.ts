/**
 * `setIcon` / `addIcon` / `getIcon` as in Obsidian, over the Lucide set Obsidian uses
 * (ids are kebab-case Lucide names, optionally prefixed `lucide-`).
 */
import { icons as lucide } from 'lucide'

type IconNode = [tag: string, attrs: Record<string, string | number>][]

/** Old Obsidian icon ids that plugins still pass. */
const LEGACY: Record<string, string> = {
  cross: 'x', gear: 'settings', hashtag: 'hash', dice: 'dice-5', documents: 'files', document: 'file',
  trash: 'trash-2', 'right-arrow': 'arrow-right', 'left-arrow': 'arrow-left', 'up-arrow-with-tail': 'arrow-up',
  'down-arrow-with-tail': 'arrow-down', 'checkmark': 'check', 'popup-open': 'external-link', 'reset': 'rotate-ccw',
  'links-coming-in': 'arrow-down-left', 'links-going-out': 'arrow-up-right',
}
const custom = new Map<string, string>()

const pascal = (id: string) => id.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())

function lucideNode(iconId: string): IconNode | undefined {
  const id = iconId.replace(/^lucide-/, '')
  return (lucide as Record<string, IconNode>)[pascal(LEGACY[id] ?? id)]
}

/** Obsidian's format: inner SVG content drawn in a 100×100 box. */
export function addIcon(iconId: string, svgContent: string) {
  custom.set(iconId, svgContent)
}

export function getIconIds(): string[] {
  return [...custom.keys(), ...Object.keys(lucide).map((k) => `lucide-${k.replace(/([a-z0-9])([A-Z0-9])/g, '$1-$2').toLowerCase()}`)]
}

const SVG = 'http://www.w3.org/2000/svg'

export function getIcon(iconId: string): SVGSVGElement | null {
  const own = custom.get(iconId)
  const node = own ? undefined : lucideNode(iconId)
  if (!own && !node) return null
  const svg = document.createElementNS(SVG, 'svg')
  const attrs: Record<string, string> = own
    ? { viewBox: '0 0 100 100', fill: 'currentColor' }
    : { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
  for (const [k, v] of Object.entries({ ...attrs, width: '18', height: '18', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  svg.classList.add('svg-icon', `lucide-${iconId.replace(/^lucide-/, '')}`)
  if (own) svg.innerHTML = own // plugin-provided markup, as Obsidian does
  else for (const [tag, a] of node!) {
    const child = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v))
    svg.appendChild(child)
  }
  return svg
}

/** Unknown ids leave the element empty, as in Obsidian. */
export function setIcon(parent: HTMLElement, iconId: string) {
  parent.empty()
  const svg = getIcon(iconId)
  if (svg) parent.appendChild(svg)
}
