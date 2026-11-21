import type { Connection, NoteCardData, Side } from '../types/note'
import { anchorPoint, bezier, pinPoint, sagString, type Point, type Size } from './geometry'

export interface PendingLink {
  fromId: string
  side: Side
  to: Point
  toSide?: Side
}

interface ConnectionsLayerProps {
  connections: Connection[]
  notesById: Map<string, NoteCardData>
  sizes: Map<string, Size>
  emphasized: boolean
  selectedConnectionId: string | null
  pending: PendingLink | null
  onSelectConnection: (id: string) => void
  /** Detective theme: strings between pins instead of side beziers. */
  strings?: boolean
}

export function ConnectionsLayer({
  connections,
  notesById,
  sizes,
  emphasized,
  selectedConnectionId,
  pending,
  onSelectConnection,
  strings = false,
}: ConnectionsLayerProps) {
  const pendingFrom = pending ? notesById.get(pending.fromId) : undefined
  return (
    <svg className={`connections-layer${emphasized ? ' is-emphasized' : ''}`}>
      {connections.map((conn) => {
        const from = notesById.get(conn.from)
        const to = notesById.get(conn.to)
        if (!from || !to) return null
        const fs = conn.fromSide ?? 'right'
        const ts = conn.toSide ?? 'left'
        const a = strings ? pinPoint(from, sizes.get(from.id)) : anchorPoint(from, sizes.get(from.id), fs)
        const b = strings ? pinPoint(to, sizes.get(to.id)) : anchorPoint(to, sizes.get(to.id), ts)
        const d = strings ? sagString(a, b) : bezier(a, fs, b, ts)
        const selected = selectedConnectionId === conn.id
        return (
          <g key={conn.id} className={`connection${selected ? ' is-selected' : ''}`}>
            <path d={d} className="connection-line" fill="none" />
            {/* wide invisible stroke = comfortable hit area */}
            <path
              d={d}
              className="connection-hit"
              fill="none"
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelectConnection(conn.id)
              }}
            />
            {!strings && <circle cx={a.x} cy={a.y} r={3.5} className="connection-dot" />}
            {!strings && <circle cx={b.x} cy={b.y} r={3.5} className="connection-dot" />}
          </g>
        )
      })}
      {pending && pendingFrom && (() => {
        const a = strings
          ? pinPoint(pendingFrom, sizes.get(pendingFrom.id))
          : anchorPoint(pendingFrom, sizes.get(pendingFrom.id), pending.side)
        const d = strings ? sagString(a, pending.to) : bezier(a, pending.side, pending.to, pending.toSide)
        return (
          <g className="connection is-pending">
            <path d={d} className="connection-line" fill="none" />
            <circle cx={a.x} cy={a.y} r={4} className="connection-dot" />
            <circle cx={pending.to.x} cy={pending.to.y} r={5} className="connection-dot" />
          </g>
        )
      })()}
    </svg>
  )
}
