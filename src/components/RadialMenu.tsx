import type { ReactNode } from 'react'
import './RadialMenu.css'

export interface RadialItem {
  id: string
  label: string
  icon: ReactNode
  disabled?: boolean
  run: () => void
}

export const RADIAL_RADIUS = 120
export const RADIAL_DEADZONE = 20

/** Start-angle offset (deg): with 10 items, shift half a step so slots sit exactly at 3 and 9 o'clock. */
export const radialOffset = (n: number) => (n % 4 === 2 ? 180 / n : 0)

/** Which item does a pointer offset (from the menu centre) point at? Items start at 12 o'clock, clockwise. */
export function radialIndex(dx: number, dy: number, count: number) {
  if (Math.hypot(dx, dy) < RADIAL_DEADZONE) return -1
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90 - radialOffset(count) // 0 = first slot
  const norm = (angle + 360 + 180 / count) % 360
  return Math.floor(norm / (360 / count))
}

interface RadialMenuProps {
  center: { x: number; y: number } | null
  items: RadialItem[]
  active: number
  onHover: (i: number) => void
  onRun: (i: number) => void
  /** Glyph of the hold key shown in the hub (⌥, Alt, `…). */
  keyGlyph?: string
}

export function RadialMenu({ center, items, active, onHover, onRun, keyGlyph = '⌥' }: RadialMenuProps) {
  if (!center) return null
  const n = items.length
  return (
    <div className="radial" style={{ left: center.x, top: center.y }}>
      <div className="radial__ring" />
      {/* icons only around the ring; the hovered action's name appears in the centre */}
      <div className={`radial__hub${active >= 0 ? ' has-label' : ''}`}>
        {active >= 0 && items[active] ? (
          <span key={items[active].id} className="radial__caption">
            {items[active].label}
          </span>
        ) : (
          <span className="radial__key">{keyGlyph}</span>
        )}
      </div>
      {items.map((item, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (radialOffset(n) * Math.PI) / 180
        const x = Math.cos(a) * RADIAL_RADIUS
        const y = Math.sin(a) * RADIAL_RADIUS
        return (
          <button
            key={item.id}
            type="button"
            className={`radial__item${i === active ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`}
            style={
              {
                '--x': `${x}px`,
                '--y': `${y}px`,
                '--delay': `${i * 18}ms`,
              } as React.CSSProperties
            }
            onPointerEnter={() => onHover(i)}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRun(i)
            }}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        )
      })}
    </div>
  )
}
