import type { ReactNode } from 'react'
import './SidePanel.css'

interface SidePanelProps {
  open: boolean
  title: string
  children: ReactNode
}

export function SidePanel({ open, title, children }: SidePanelProps) {
  return (
    <div className={`side-panel glass-panel-strong${open ? ' is-open' : ''}`}>
      <div className="side-panel__header">{title}</div>
      <div className="side-panel__body">{children}</div>
    </div>
  )
}
