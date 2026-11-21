import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasBoard } from './components/CanvasBoard'
import { CommandDock } from './components/CommandDock'
import type { ViewMode } from './components/TopBar'
import { SidePanel } from './components/SidePanel'
import { QuickSearch } from './components/QuickSearch'
import { RadialMenu, radialIndex, type RadialItem } from './components/RadialMenu'
import { NotesList } from './components/NotesList'
import { NoteMenu } from './components/NoteMenu'
import { OPPOSITE, type Point } from './components/geometry'
import { THEMES, isRadialKey, keyGlyph, type AppSettings } from './settings/settings'
import { useCanvasTransform } from './hooks/useCanvasTransform'
import { usePersistentState } from './hooks/usePersistentState'
import { DEFAULT_VAULT_ID, vaultKey } from './hooks/vaultKeys'
import { GUIDE_BOUNDS, guideContent, translateGuide } from './data/guide'
import type { ChipColor, Connection, Frame, InkColor, InkStroke, InkTool, NoteCardData, Side, TagChip, Vault } from './types/note'
import { TagChipLayer, TagPanel, snapTo, type ChipDrop } from './components/TagButtons'
import { GRID } from './settings/settings'
import { getLang, useT } from './i18n'
import { InkCapture, InkLayer, strokeBounds } from './components/Ink'
import { InkToolbar } from './components/InkToolbar'
import { FrameLayer } from './components/Frames'
import { FrameMenu } from './components/FrameMenu'
import { ChipMenu } from './components/ChipMenu'
import { chipEffect, type ObjectFx } from './effects/tagEffects'
import { CHIP_COLORS } from './types/note'
import { RadialIcon } from './components/RadialIcons'

let noteCounter = 1
const newId = () => `note-${Date.now()}-${++noteCounter}`
const W = 260
type GroupSel = { chips: string[]; frames: string[] }
const NO_GROUP: GroupSel = { chips: [], frames: [] }
const H = 160

/** View transform that fits a world rect between the top bar and the dock. */
function fitTransform(b: { x: number; y: number; width: number; height: number }) {
  const top = 64
  const bottom = 112
  const side = 40
  const w = Math.max(200, window.innerWidth - side * 2)
  const h = Math.max(200, window.innerHeight - top - bottom)
  const s = Math.min(1, Math.max(0.35, Math.min(w / b.width, h / b.height)))
  return { scale: s, x: side + (w - b.width * s) / 2 - b.x * s, y: top + (h - b.height * s) / 2 - b.y * s }
}

const isTyping = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')

export interface WorkspaceApi {
  newNote: () => void
}

interface WorkspaceProps {
  vault: Vault
  /** false while the pane is sliding out: no keyboard handling. */
  active: boolean
  apiRef?: React.MutableRefObject<WorkspaceApi | null>
  settings: AppSettings
  patchSettings: (p: Partial<AppSettings>) => void
  settingsOpen: boolean
  onOpenSettings: () => void
  viewMode: ViewMode
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>
  onZoomChange?: (percent: number) => void
  /** Switch to the neighbouring vault tab: 1 = right, -1 = left. */
  onSwitchTab?: (dir: 1 | -1) => void
  tabCount?: number
}

/** Everything that belongs to one vault. Re-mounted (key) when the vault changes. */
export function Workspace({
  vault,
  active,
  apiRef,
  settings,
  patchSettings,
  settingsOpen,
  onOpenSettings,
  viewMode,
  setViewMode,
  onZoomChange,
  onSwitchTab,
  tabCount = 1,
}: WorkspaceProps) {
  const tr = useT()
  const isFirst = vault.id === DEFAULT_VAULT_ID
  // fresh first vault (or «Settings → Guide»): starts with the feature guide
  const [guide] = useState(() =>
    isFirst || vault.seed === 'guide' ? guideContent(getLang(), settings.radialKey || 'Alt') : null,
  )
  const [notes, setNotes] = usePersistentState<NoteCardData[]>(vaultKey(vault.id, 'notes'), guide?.notes ?? [])
  const [connections, setConnections] = usePersistentState<Connection[]>(
    vaultKey(vault.id, 'connections'),
    guide?.connections ?? [],
  )
  const [chips, setChips] = usePersistentState<TagChip[]>(vaultKey(vault.id, 'chips'), guide?.chips ?? [])
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null)
  const [selectedId, setPrimaryId] = useState<string | null>(null)
  /** Multi-selection (Ctrl/⌘+click, Ctrl+drag box). Empty = only `selectedId`; otherwise it contains it. */
  const [multiIds, setMultiIds] = useState<string[]>([])
  /** Buttons and frames taken by a box selection / Ctrl+A (together with the notes in `multiIds`). */
  const [groupSel, setGroupSel] = useState<GroupSel>(NO_GROUP)
  const groupSelRef = useRef(groupSel)
  groupSelRef.current = groupSel
  /** Which ids are buttons / frames — filled in below, once frames are known. */
  const kindRef = useRef<{ chips: Set<string>; frames: Set<string> }>({ chips: new Set(), frames: new Set() })
  /** Plain single selection: also drops any multi-selection. */
  const setSelectedId = useCallback((v: string | null | ((s: string | null) => string | null)) => {
    setMultiIds((m) => (m.length ? [] : m))
    setGroupSel((g) => (g.chips.length || g.frames.length ? NO_GROUP : g))
    setPrimaryId(v)
  }, [])
  const selectedIds = useMemo(
    () => new Set(multiIds.length ? multiIds : selectedId ? [selectedId] : []),
    [multiIds, selectedId],
  )
  const groupSize = selectedIds.size + groupSel.chips.length + groupSel.frames.length
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  /** Replace the whole selection (box select, Ctrl+A): notes, buttons and frames. */
  const selectMany = useCallback((ids: string[]) => {
    const k = kindRef.current
    const chipIds = ids.filter((id) => k.chips.has(id))
    const frameIds = ids.filter((id) => k.frames.has(id))
    const noteIds = ids.filter((id) => !k.chips.has(id) && !k.frames.has(id))
    const total = ids.length
    setSelectedConnectionId(null)
    // a single button / frame is an ordinary single selection
    if (total === 1 && chipIds.length) {
      setMultiIds([]); setGroupSel(NO_GROUP); setPrimaryId(null); setSelectedFrameId(null)
      setSelectedChipId(chipIds[0])
      return
    }
    if (total === 1 && frameIds.length) {
      setMultiIds([]); setGroupSel(NO_GROUP); setPrimaryId(null); setSelectedChipId(null)
      setSelectedFrameId(frameIds[0])
      return
    }
    setMultiIds(noteIds.length > 1 || total > 1 ? noteIds : [])
    setPrimaryId(noteIds.length ? noteIds[noteIds.length - 1] : null)
    setGroupSel(chipIds.length || frameIds.length ? { chips: chipIds, frames: frameIds } : NO_GROUP)
    setSelectedFrameId(null)
    setSelectedChipId(null)
  }, [])
  /** Ctrl/⌘+click: add or remove one note, like icons on a desktop. */
  const toggleSelect = useCallback(
    (id: string) => {
      const g = groupSelRef.current
      const cur = [...selectedIdsRef.current, ...g.chips, ...g.frames]
      selectMany(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
    },
    [selectMany],
  )
  const [editing, setEditing] = useState<{ id: string; focus: 'title' | 'body' } | null>(null)
  // selecting anything else (or nothing) ends inline editing
  if (editing && editing.id !== selectedId) setEditing(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const [graphMode, setGraphMode] = usePersistentState('panel-graph', false)
  const [tagsOpen, setTagsOpen] = usePersistentState('panel-tags', false)
  const [vaultOpen, setVaultOpen] = usePersistentState('panel-vault', false)
  const [activeTagFilters, setActiveTagFilters] = usePersistentState<string[]>('active-tag-filters', [])

  // ---------- freehand ink & smart frames (per vault) ----------
  const [strokes, setStrokes] = usePersistentState<InkStroke[]>(vaultKey(vault.id, 'ink'), guide?.strokes ?? [])
  const [frames, setFrames] = usePersistentState<Frame[]>(vaultKey(vault.id, 'frames'), guide?.frames ?? [])
  const [inkPrefs, setInkPrefs] = usePersistentState<{ tool: InkTool; color: InkColor }>('ink-tool', {
    tool: 'pen',
    color: 'chalk',
  })
  const [drawing, setDrawing] = useState(false)
  kindRef.current = { chips: new Set(chips.map((c) => c.id)), frames: new Set(frames.map((f) => f.id)) }
  const chipsRef = useRef(chips)
  chipsRef.current = chips

  // language switched in Settings → the guide notes the user hasn't edited follow it
  const langRef = useRef(settings.language)
  useEffect(() => {
    const from = langRef.current
    const to = settings.language
    langRef.current = to
    if (from === to) return
    const next = translateGuide({ notes: notesRef.current, frames: framesRef.current, chips: chipsRef.current }, from, to, settings.radialKey || 'Alt')
    if (!next) return
    setNotes(next.notes)
    setFrames(next.frames)
    setChips(next.chips)
  }, [settings.language, settings.radialKey, setNotes, setFrames, setChips])
  const framesRef = useRef(frames)
  framesRef.current = frames
  if (drawing && viewMode !== 'canvas') setDrawing(false)
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null)

  const notesRef = useRef(notes)
  notesRef.current = notes
  const radialKey = settings.radialKey || 'Alt'
  const dockInputRef = useRef<HTMLInputElement>(null)
  const panPointer = useRef<number | null>(null)
  const mouse = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  const { transform, startPan, panTo, endPan, zoomAt, panBy, setScale, fitRect } = useCanvasTransform(
    vaultKey(vault.id, 'canvas-transform'),
    guide ? fitTransform(GUIDE_BOUNDS) : undefined,
  )

  const toWorld = useCallback(
    (p: Point): Point => ({ x: (p.x - transform.x) / transform.scale, y: (p.y - transform.y) / transform.scale }),
    [transform],
  )

  // ---------- ink ----------
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const inkHistory = useRef<InkStroke[][]>([])
  const [historyLen, setHistoryLen] = useState(0)
  const pushInkHistory = useCallback((snap: InkStroke[]) => {
    inkHistory.current.push(snap)
    if (inkHistory.current.length > 50) inkHistory.current.shift()
    setHistoryLen(inkHistory.current.length)
  }, [])
  const undoInk = useCallback(() => {
    const prev = inkHistory.current.pop()
    setHistoryLen(inkHistory.current.length)
    if (prev) setStrokes(prev)
  }, [setStrokes])
  const eraseSnap = useRef<InkStroke[] | null>(null)
  const addStroke = useCallback(
    (st: InkStroke) => {
      pushInkHistory(strokesRef.current)
      setStrokes((prev) => [...prev, st])
    },
    [pushInkHistory, setStrokes],
  )
  const eraseStrokes = useCallback(
    (changes: Map<string, InkStroke[]>) => {
      if (eraseSnap.current) {
        pushInkHistory(eraseSnap.current)
        eraseSnap.current = null
      }
      setStrokes((prev) => prev.flatMap((st) => changes.get(st.id) ?? [st]))
    },
    [pushInkHistory, setStrokes],
  )
  const clearInk = useCallback(() => {
    if (!strokesRef.current.length) return
    pushInkHistory(strokesRef.current)
    setStrokes([])
  }, [pushInkHistory, setStrokes])

  // ---------- smart frames ----------
  const selectFrame = useCallback((id: string | null) => {
    if (id && isGroupedRef.current(id)) return // pressing a frame of a multi-selection keeps the selection
    setSelectedFrameId(id)
    if (id) {
      setSelectedId(null)
      setSelectedConnectionId(null)
    }
  }, [])
  const patchFrame = useCallback(
    (id: string, patch: Partial<Frame>) => setFrames((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f))),
    [setFrames],
  )
  const deleteFrame = useCallback(
    (id: string) => {
      setFrames((prev) => prev.filter((f) => f.id !== id))
      setSelectedFrameId((s) => (s === id ? null : s))
    },
    [setFrames],
  )
  const frameDrag = useRef<{
    frame: Frame
    notes: Map<string, Point>
    strokes: Map<string, Point>
    frames: Map<string, Point>
  } | null>(null)
  const startFrameDrag = useCallback(
    (id: string) => {
      if (isGroupedRef.current(id)) return // the group drag snapshots everything on the first move
      const f = frames.find((x) => x.id === id)
      if (!f) return
      const inside = (x: number, y: number) => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height
      const ns = new Map<string, Point>()
      for (const n of notes) if (!n.locked && inside(n.x + n.width / 2, n.y + n.height / 2)) ns.set(n.id, { x: n.x, y: n.y })
      const ss = new Map<string, Point>()
      for (const st of strokesRef.current) {
        const b = strokeBounds(st)
        if (inside((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)) ss.set(st.id, { x: st.x, y: st.y })
      }
      // frames nested completely inside travel with their parent
      const fs = new Map<string, Point>()
      for (const o of frames)
        if (o.id !== id && !o.locked && inside(o.x, o.y) && inside(o.x + o.width, o.y + o.height)) fs.set(o.id, { x: o.x, y: o.y })
      if (ss.size) {
        // stroke positions change: earlier ink undo steps would teleport them back
        inkHistory.current = []
        setHistoryLen(0)
      }
      frameDrag.current = { frame: f, notes: ns, strokes: ss, frames: fs }
    },
    [frames, notes],
  )
  const dragFrame = useCallback(
    (id: string, dx: number, dy: number) => {
      if (isGroupedRef.current(id)) return groupMoveByRef.current(id, Math.round(dx), Math.round(dy))
      const d = frameDrag.current
      if (!d || d.frame.id !== id) return
      const rx = Math.round(dx)
      const ry = Math.round(dy)
      setFrames((prev) =>
        prev.map((f) => {
          if (f.id === id) return { ...f, x: d.frame.x + rx, y: d.frame.y + ry }
          const p = d.frames.get(f.id)
          return p ? { ...f, x: p.x + rx, y: p.y + ry } : f
        }),
      )
      if (d.notes.size)
        setNotes((prev) =>
          prev.map((n) => {
            const p = d.notes.get(n.id)
            return p ? { ...n, x: p.x + rx, y: p.y + ry } : n
          }),
        )
      if (d.strokes.size)
        setStrokes((prev) =>
          prev.map((st) => {
            const p = d.strokes.get(st.id)
            return p ? { ...st, x: p.x + rx, y: p.y + ry } : st
          }),
        )
    },
    [setFrames, setNotes, setStrokes],
  )
  const endFrameDrag = useCallback(() => {
    frameDrag.current = null
  }, [])
  const frameContents = useCallback(
    (f: Frame) =>
      notes.filter((n) => {
        const cx = n.x + n.width / 2
        const cy = n.y + n.height / 2
        return cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height
      }),
    [notes],
  )
  const frameCounts = useMemo(() => new Map(frames.map((f) => [f.id, frameContents(f).length])), [frames, frameContents])
  // big frames underneath, small ones on top — every header stays reachable
  const framesSorted = useMemo(() => [...frames].sort((a, b) => b.width * b.height - a.width * a.height), [frames])
  const fitFrame = useCallback(
    (id: string) => {
      const f = frames.find((x) => x.id === id)
      if (!f) return
      const inner = frameContents(f)
      if (!inner.length) return
      const pad = 32
      const minX = Math.min(...inner.map((n) => n.x)) - pad
      const minY = Math.min(...inner.map((n) => n.y)) - pad - 40
      const maxX = Math.max(...inner.map((n) => n.x + n.width)) + pad
      const maxY = Math.max(...inner.map((n) => n.y + n.height)) + pad
      patchFrame(id, {
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.round(Math.max(200, maxX - minX)),
        height: Math.round(Math.max(140, maxY - minY)),
      })
    },
    [frames, frameContents, patchFrame],
  )

  // ---------- frame context menu (right click) ----------
  const [frameMenu, setFrameMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const closeFrameMenu = useCallback(() => setFrameMenu(null), [])
  const openFrameMenu = useCallback((id: string, x: number, y: number) => setFrameMenu({ id, x, y }), [])
  // tag button context menu (right click) — declared here: the keyboard effect below depends on it
  const [chipMenu, setChipMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const closeChipMenu = useCallback(() => setChipMenu(null), [])
  const duplicateFrame = useCallback(
    (id: string) => {
      const src = frames.find((f) => f.id === id)
      if (!src) return
      const copy: Frame = { ...src, id: `frame-${Date.now().toString(36)}`, x: src.x + 32, y: src.y + 32, locked: false }
      setFrames((prev) => [...prev, copy])
      selectFrame(copy.id)
    },
    [frames, setFrames, selectFrame],
  )
  /** Right click on the empty inside of a frame: the smallest frame under the cursor gets the menu. */
  const frameContextMenu = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement
    if (viewMode !== 'canvas' || e.ctrlKey || !el.closest('.canvas-board')) return
    if (el.closest('[data-note-id], [data-chip-id], [data-frame-id], .connection, .note-menu')) return
    const p = toWorld({ x: e.clientX, y: e.clientY })
    const hit = [...framesSorted].reverse().find((f) => p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height)
    if (!hit) return
    e.preventDefault()
    selectFrame(hit.id)
    openFrameMenu(hit.id, e.clientX, e.clientY)
  }

  // ---------- note operations ----------
  const updateNote = useCallback(
    (id: string, patch: Partial<NoteCardData>) =>
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n))),
    [setNotes],
  )

  const addNote = useCallback(
    (title: string, at: Point) => {
      const id = newId()
      setNotes((prev) => [
        ...prev,
        { id, title: title || tr('Нова нотатка'), tags: [], x: at.x, y: at.y, width: W, height: H, body: '', updatedAt: Date.now() },
      ])
      setSelectedId(id)
      setEditing({ id, focus: title ? 'body' : 'title' })
      return id
    },
    [setNotes],
  )

  const createNote = useCallback(
    (title: string) => {
      const c = toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      return addNote(title, { x: c.x - W / 2, y: c.y - H / 2 })
    },
    [addNote, toWorld],
  )

  const deleteNote = useCallback(
    (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id))
      setConnections((prev) => prev.filter((c) => c.from !== id && c.to !== id))
      setPrimaryId((s) => (s === id ? null : s))
      setMultiIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : m))
    },
    [setNotes, setConnections],
  )
  /** Delete every selected note (one or many). */
  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current
    const g = groupSelRef.current
    if (!ids.size && !g.chips.length && !g.frames.length) return
    setNotes((prev) => prev.filter((n) => !ids.has(n.id)))
    setConnections((prev) => prev.filter((c) => !ids.has(c.from) && !ids.has(c.to)))
    if (g.chips.length) setChips((prev) => prev.filter((c) => !g.chips.includes(c.id)))
    if (g.frames.length) setFrames((prev) => prev.filter((f) => !g.frames.includes(f.id)))
    setPrimaryId(null)
    setMultiIds([])
    setGroupSel(NO_GROUP)
  },
    [setNotes, setConnections, setChips, setFrames],
  )

  const duplicateNote = useCallback(
    (id: string) => {
      const src = notes.find((n) => n.id === id)
      if (!src) return
      const copy: NoteCardData = {
        ...structuredClone(src),
        id: newId(),
        x: src.x + 32,
        y: src.y + 32,
        locked: false,
        updatedAt: Date.now(),
      }
      setNotes((prev) => [...prev, copy])
      setSelectedId(copy.id)
    },
    [notes, setNotes],
  )

  const reorderNote = useCallback(
    (id: string, toFront: boolean) =>
      setNotes((prev) => {
        const n = prev.find((x) => x.id === id)
        if (!n) return prev
        const rest = prev.filter((x) => x.id !== id)
        return toFront ? [...rest, n] : [n, ...rest]
      }),
    [setNotes],
  )

  const copyNoteText = useCallback(
    async (id: string) => {
      const n = notes.find((x) => x.id === id)
      if (!n) return false
      const parts = [n.title]
      if (n.body) parts.push(n.body)
      if (n.checklist?.length) parts.push(n.checklist.map((i) => `- [${i.done ? 'x' : ' '}] ${i.label}`).join('\n'))
      if (n.code) parts.push('```' + n.code.language + '\n' + n.code.content + '\n```')
      if (n.tags.length) parts.push(n.tags.map((t) => '#' + t).join(' '))
      try {
        await navigator.clipboard.writeText(parts.join('\n\n'))
        return true
      } catch {
        return false
      }
    },
    [notes],
  )

  const handleConnect = useCallback(
    (from: string, fromSide: Side, to: string, toSide: Side) => {
      setConnections((prev) => {
        const dup = prev.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))
        if (dup) return prev
        return [...prev, { id: `conn-${Date.now()}`, from, to, fromSide, toSide }]
      })
    },
    [setConnections],
  )

  const handleCreateLinked = useCallback(
    (fromId: string, side: Side, at: Point | null) => {
      const src = notes.find((n) => n.id === fromId)
      if (!src) return
      const gap = 120
      let x: number
      let y: number
      if (at) {
        const toSide = OPPOSITE[side]
        x = toSide === 'left' ? at.x : toSide === 'right' ? at.x - W : at.x - W / 2
        y = toSide === 'top' ? at.y : toSide === 'bottom' ? at.y - H : at.y - H / 2
      } else {
        const cx = src.x + src.width / 2
        const cy = src.y + src.height / 2
        x = side === 'right' ? src.x + src.width + gap : side === 'left' ? src.x - W - gap : cx - W / 2
        y = side === 'bottom' ? src.y + src.height + gap : side === 'top' ? src.y - H - gap : cy - H / 2
      }
      const id = addNote('', { x, y })
      setConnections((prev) => [
        ...prev,
        { id: `conn-${Date.now()}`, from: fromId, to: id, fromSide: side, toSide: OPPOSITE[side] },
      ])
    },
    [notes, addNote, setConnections],
  )

  // ---------- group drag: notes, buttons and frames of a multi-selection move together ----------
  /** Is this note / button / frame part of a selection of 2+ objects? */
  const isGrouped = (id: string) => {
    const g = groupSelRef.current
    const size = selectedIdsRef.current.size + g.chips.length + g.frames.length
    return size > 1 && (selectedIdsRef.current.has(id) || g.chips.includes(id) || g.frames.includes(id))
  }
  const isGroupedRef = useRef(isGrouped)
  isGroupedRef.current = isGrouped
  const groupDrag = useRef<{
    lead: string
    origin: Point
    notes: Map<string, Point>
    chips: Map<string, Point>
    frames: Map<string, Point>
    strokes: Map<string, Point>
  } | null>(null)
  /** Snapshot of everything that moves: selected objects + the contents of selected frames (locked ones stay). */
  const beginGroupDrag = (lead: string) => {
    const g = groupSelRef.current
    const sel = selectedIdsRef.current
    const fs = framesRef.current.filter((f) => g.frames.includes(f.id))
    const inside = (f: Frame, x: number, y: number) => x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height
    const inSelFrame = (x: number, y: number) => fs.some((f) => inside(f, x, y))
    const notesM = new Map<string, Point>()
    for (const n of notesRef.current)
      if ((n.id === lead || !n.locked) && (sel.has(n.id) || inSelFrame(n.x + n.width / 2, n.y + n.height / 2))) notesM.set(n.id, { x: n.x, y: n.y })
    const framesM = new Map<string, Point>()
    for (const f of framesRef.current)
      if ((f.id === lead || !f.locked) && (g.frames.includes(f.id) || fs.some((o) => o.id !== f.id && inside(o, f.x, f.y) && inside(o, f.x + f.width, f.y + f.height))))
        framesM.set(f.id, { x: f.x, y: f.y })
    const strokesM = new Map<string, Point>()
    for (const st of strokesRef.current) {
      const b = strokeBounds(st)
      if (inSelFrame((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)) strokesM.set(st.id, { x: st.x, y: st.y })
    }
    if (strokesM.size) {
      inkHistory.current = []
      setHistoryLen(0)
    }
    const chipsM = new Map<string, Point>()
    for (const c of chipsRef.current) if (g.chips.includes(c.id)) chipsM.set(c.id, { x: c.x, y: c.y })
    const origin =
      notesM.get(lead) ?? chipsM.get(lead) ?? framesM.get(lead) ?? { x: 0, y: 0 }
    groupDrag.current = { lead, origin, notes: notesM, chips: chipsM, frames: framesM, strokes: strokesM }
    const reset = () => {
      groupDrag.current = null
      window.removeEventListener('pointerup', reset, true)
      window.removeEventListener('pointercancel', reset, true)
    }
    window.addEventListener('pointerup', reset, true)
    window.addEventListener('pointercancel', reset, true)
  }
  /** Move the whole group by (dx, dy) from where it was when the drag started. */
  const groupMoveBy = (lead: string, dx: number, dy: number) => {
    if (!groupDrag.current || groupDrag.current.lead !== lead) beginGroupDrag(lead)
    const d = groupDrag.current!
    const shift = <T extends { id: string; x: number; y: number }>(m: Map<string, Point>) => (prev: T[]) =>
      m.size ? prev.map((o) => { const p = m.get(o.id); return p ? { ...o, x: p.x + dx, y: p.y + dy } : o }) : prev
    setNotes(shift<NoteCardData>(d.notes))
    setChips(shift<TagChip>(d.chips))
    setFrames(shift<Frame>(d.frames))
    if (d.strokes.size) setStrokes(shift<InkStroke>(d.strokes))
  }
  const groupMoveByRef = useRef(groupMoveBy)
  groupMoveByRef.current = groupMoveBy
  /** Move the group so that the dragged object (lead) ends up at (x, y). */
  const groupMoveTo = (lead: string, x: number, y: number) => {
    if (!groupDrag.current || groupDrag.current.lead !== lead) beginGroupDrag(lead)
    const o = groupDrag.current!.origin
    groupMoveBy(lead, x - o.x, y - o.y)
  }
  const groupMoveToRef = useRef(groupMoveTo)
  groupMoveToRef.current = groupMoveTo

  const handleMove = useCallback(
    (id: string, x: number, y: number) => {
      if (isGroupedRef.current(id)) return groupMoveToRef.current(id, x, y)
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)))
    },
    [setNotes],
  )

  const handleResizeNote = useCallback(
    (id: string, width: number, height: number) =>
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, width, height } : n))),
    [setNotes],
  )

  const handleToggleChecklist = useCallback(
    (noteId: string, itemId: string) =>
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? { ...n, checklist: n.checklist?.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) }
            : n,
        ),
      ),
    [setNotes],
  )

  // ---------- view helpers ----------
  const fitAll = useCallback(() => {
    const boxes = [
      ...notes.map((n) => ({ x0: n.x, y0: n.y, x1: n.x + n.width, y1: n.y + n.height })),
      ...frames.map((f) => ({ x0: f.x, y0: f.y, x1: f.x + f.width, y1: f.y + f.height })),
      ...chips.map((c) => ({ x0: c.x, y0: c.y, x1: c.x + 140, y1: c.y + 30 })),
      ...strokes.map((st) => {
        const b = strokeBounds(st)
        return { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY }
      }),
    ]
    if (!boxes.length) return
    const minX = Math.min(...boxes.map((b) => b.x0))
    const minY = Math.min(...boxes.map((b) => b.y0))
    const maxX = Math.max(...boxes.map((b) => b.x1))
    const maxY = Math.max(...boxes.map((b) => b.y1))
    fitRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
  }, [notes, frames, strokes, chips, fitRect])

  /** Dock «Frame»: wraps the selected note, otherwise a new empty group in the middle of the view. */
  const createFrame = useCallback(() => {
    const picked = notes.filter((n) => selectedIds.has(n.id))
    let rect: { x: number; y: number; width: number; height: number }
    if (picked.length) {
      const x0 = Math.min(...picked.map((n) => n.x))
      const y0 = Math.min(...picked.map((n) => n.y))
      const x1 = Math.max(...picked.map((n) => n.x + n.width))
      const y1 = Math.max(...picked.map((n) => n.y + n.height))
      rect = { x: x0 - 32, y: y0 - 72, width: Math.max(200, x1 - x0 + 64), height: Math.max(140, y1 - y0 + 104) }
    } else {
      const c = toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      rect = { x: c.x - 260, y: c.y - 180, width: 520, height: 360 }
    }
    const id = `frame-${Date.now().toString(36)}`
    setFrames((prev) => [
      ...prev,
      { id, title: tr('Нова група'), color: 'default', ...Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v)])) } as Frame,
    ])
    selectFrame(id)
    setDrawing(false)
  }, [selectedIds, notes, toWorld, setFrames, selectFrame])

  const jumpTo = useCallback(
    (note: NoteCardData) => {
      setSelectedId(note.id)
      if (viewMode === 'canvas') fitRect({ x: note.x, y: note.y, width: note.width, height: note.height }, transform.scale < 0.6 ? 1 : transform.scale, 200)
    },
    [viewMode, fitRect, transform.scale],
  )

  // ---------- note context menu (right click) ----------
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = useCallback((id: string, x: number, y: number) => setMenu({ id, x, y }), [])

  // ---------- radial (hold ⌥) ----------
  const [radial, setRadial] = useState<Point | null>(null)
  const [radialActive, setRadialActive] = useState(-1)
  const radialItems: RadialItem[] = useMemo(() => {
    const nextTheme = THEMES[(THEMES.findIndex((t) => t.id === settings.theme) + 1) % THEMES.length]
    return [
      {
        id: 'new',
        label: tr('Нова нотатка тут'),
        icon: <RadialIcon name="new" />,
        run: () => {
          if (viewMode !== 'canvas') return void createNote('')
          const p = toWorld(radial ?? mouse.current)
          addNote('', { x: p.x - W / 2, y: p.y - H / 2 })
        },
      },
      { id: 'search', label: tr('Швидкий пошук'), icon: <RadialIcon name="search" />, run: () => setSearchOpen(true) },
      {
        id: 'tab-next',
        label: tr('Вкладка праворуч'),
        icon: <RadialIcon name="tab-next" />,
        disabled: tabCount < 2,
        run: () => onSwitchTab?.(1),
      },
      { id: 'fit', label: tr('Вмістити все'), icon: <RadialIcon name="fit" />, disabled: viewMode !== 'canvas', run: fitAll },
      {
        id: 'zoom',
        label: tr('Масштаб 100%'),
        icon: <RadialIcon name="zoom" />,
        disabled: viewMode !== 'canvas',
        run: () => setScale(1, window.innerWidth / 2, window.innerHeight / 2),
      },
      {
        id: 'view',
        label: viewMode === 'canvas' ? tr('Вигляд: нотатки') : tr('Вигляд: полотно'),
        icon: <RadialIcon name={viewMode === 'canvas' ? 'list' : 'canvas'} />,
        run: () => setViewMode((m) => (m === 'canvas' ? 'list' : 'canvas')),
      },
      {
        id: 'theme',
        label: tr('Тема: {name}', { name: tr(nextTheme.name) }),
        icon: <RadialIcon name="theme" />,
        run: () => patchSettings({ theme: nextTheme.id }),
      },
      {
        id: 'tab-prev',
        label: tr('Вкладка ліворуч'),
        icon: <RadialIcon name="tab-prev" />,
        disabled: tabCount < 2,
        run: () => onSwitchTab?.(-1),
      },
      { id: 'settings', label: tr('Налаштування'), icon: <RadialIcon name="settings" />, run: onOpenSettings },
      {
        id: 'delete',
        label: tr('Видалити виділене'),
        icon: <RadialIcon name="delete" />,
        disabled: !selectedId && !selectedConnectionId && !selectedChipId && groupSize < 2,
        run: () => {
          if (selectedChipId) {
            setChips((prev) => prev.filter((c) => c.id !== selectedChipId))
            setSelectedChipId(null)
          } else if (selectedConnectionId) {
            setConnections((prev) => prev.filter((c) => c.id !== selectedConnectionId))
            setSelectedConnectionId(null)
          } else deleteSelected()
        },
      },
    ]
  }, [settings.theme, viewMode, toWorld, radial, addNote, createNote, fitAll, setScale, setViewMode, patchSettings, onOpenSettings, selectedId, selectedConnectionId, setConnections, deleteSelected, onSwitchTab, tabCount, tr, selectedChipId, setChips, groupSize])

  const radialRef = useRef({ radial, radialActive, radialItems })
  radialRef.current = { radial, radialActive, radialItems }

  const runRadial = useCallback((i: number) => {
    const item = radialRef.current.radialItems[i]
    setRadial(null)
    setRadialActive(-1)
    if (item && !item.disabled) item.run()
  }, [])

  // ---------- keyboard ----------
  const overlayOpen = settingsOpen || searchOpen
  useEffect(() => {
    if (!active) return
    const onMove = (e: PointerEvent | MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY }
      const r = radialRef.current.radial
      if (r) setRadialActive(radialIndex(e.clientX - r.x, e.clientY - r.y, radialRef.current.radialItems.length))
    }
    const down = (e: KeyboardEvent) => {
      const typing = isTyping(e.target)
      if (isRadialKey(e, radialKey) && !typing && !overlayOpen) {
        // preventDefault also stops Windows from activating the window menu on Alt release
        e.preventDefault()
        if (!e.repeat && !radialRef.current.radial) {
          setMenu(null)
          setRadial({ ...mouse.current })
          setRadialActive(-1)
        }
        return
      }
      // any other key while ⌥ is held = the user wanted an ⌥-shortcut, not the menu
      if (radialRef.current.radial) {
        setRadial(null)
        if (e.key === 'Escape') return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (viewMode === 'canvas') {
          dockInputRef.current?.focus()
          dockInputRef.current?.select()
        } else setSearchOpen(true)
        return
      }
      if (typing || overlayOpen) return
      if (drawing && viewMode === 'canvas') {
        const k = e.key.toLowerCase()
        if ((e.metaKey || e.ctrlKey) && k === 'z') {
          e.preventDefault()
          undoInk()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setDrawing(false)
          return
        }
        if (!e.metaKey && !e.ctrlKey && !e.altKey && (k === 'p' || k === 'm' || k === 'e')) {
          setInkPrefs((p) => ({ ...p, tool: k === 'p' ? 'pen' : k === 'm' ? 'marker' : 'eraser' }))
          return
        }
        if (e.key === ' ') return // held Space = pan while drawing
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (selectedId && viewMode === 'canvas') duplicateNote(selectedId)
        return
      }
      if (menu || frameMenu || chipMenu) return
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (e.key === 'Enter' && selectedId && viewMode === 'canvas') {
        e.preventDefault()
        setEditing({ id: selectedId, focus: 'body' })
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA' && viewMode === 'canvas') {
        e.preventDefault()
        selectMany([...notesRef.current.map((n) => n.id), ...chipsRef.current.map((c) => c.id), ...framesRef.current.map((f) => f.id)])
        return
      }
      if (e.key === 'Escape') {
        setSelectedChipId(null)
        setSelectedId(null)
        setSelectedConnectionId(null)
        setSelectedFrameId(null)
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedChipId && viewMode === 'canvas') {
          setChips((prev) => prev.filter((c) => c.id !== selectedChipId))
          setSelectedChipId(null)
        } else if (selectedFrameId && viewMode === 'canvas') deleteFrame(selectedFrameId)
        else if (selectedConnectionId) {
          setConnections((prev) => prev.filter((c) => c.id !== selectedConnectionId))
          setSelectedConnectionId(null)
        } else if ((selectedId || groupSelRef.current.chips.length || groupSelRef.current.frames.length) && viewMode === 'canvas') deleteSelected()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (!isRadialKey(e, radialKey) || !radialRef.current.radial) return
      e.preventDefault()
      runRadial(radialRef.current.radialActive)
    }
    const blur = () => setRadial(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [active, overlayOpen, viewMode, selectedId, selectedConnectionId, setConnections, deleteSelected, selectMany, radialKey, runRadial, duplicateNote, menu, drawing, undoInk, setInkPrefs, selectedFrameId, deleteFrame, selectedChipId, setChips, frameMenu, chipMenu])

  // ---------- dock ----------
  const handleDockSubmit = useCallback(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    const existing = notes.find((n) => n.title.toLowerCase() === trimmed.toLowerCase())
    if (existing) jumpTo(existing)
    else createNote(trimmed)
    setQuery('')
  }, [query, notes, createNote, jumpTo])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    notes.forEach((n) => n.tags.forEach((t) => set.add(t)))
    return Array.from(set)
  }, [notes])

  const toggleTagFilter = (tag: string) =>
    setActiveTagFilters((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))

  // ---------- tag buttons ----------
  const gridStep = GRID[settings.grid].size
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)))
    return m
  }, [notes])
  const noteTags = useMemo(() => allTags.map((tag) => ({ tag, count: tagCounts.get(tag) ?? 0 })), [allTags, tagCounts])
  const addTagToNote = useCallback(
    (noteId: string, tag: string) =>
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId && !n.tags.includes(tag) ? { ...n, tags: [...n.tags, tag], updatedAt: Date.now() } : n)),
      ),
    [setNotes],
  )
  // ---------- tag button wiring & effects ----------
  const patchChip = useCallback(
    (id: string, patch: Partial<TagChip>) => setChips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    [setChips],
  )
  /** World rects of everything a cable can plug into. */
  const wireTargets = useMemo(() => {
    const m = new Map<string, { x: number; y: number; width: number; height: number }>()
    for (const f of frames) m.set(f.id, { x: f.x, y: f.y, width: f.width, height: f.height })
    for (const n of notes) m.set(n.id, { x: n.x, y: n.y, width: n.width, height: n.height })
    return m
  }, [notes, frames])
  /** Cable released: note under the pointer, else a frame (its header/edge or the empty inside). */
  const wireChip = (chipId: string, clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    if (!el || el.closest('.side-panel, .command-dock, .top-bar, .ink-toolbar')) return
    let target = el.closest<HTMLElement>('[data-note-id]')?.dataset.noteId ?? el.closest<HTMLElement>('[data-frame-id]')?.dataset.frameId
    if (!target && el.closest('.canvas-board')) {
      const p = toWorld({ x: clientX, y: clientY })
      target = [...framesSorted].reverse().find((f) => p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height)?.id
    }
    if (!target) return
    const t = target
    setChips((prev) =>
      prev.map((c) => (c.id === chipId && !(c.targets ?? []).includes(t) ? { ...c, targets: [...(c.targets ?? []), t] } : c)),
    )
  }
  const cutWire = (chipId: string, targetId: string) =>
    setChips((prev) => prev.map((c) => (c.id === chipId ? { ...c, targets: (c.targets ?? []).filter((t) => t !== targetId) } : c)))
  const liveWires = (c: TagChip) => (c.targets ?? []).filter((t) => wireTargets.has(t))
  /** Click on a canvas button: wired → switch its effect, otherwise filter by its tag. */
  const triggerChip = (c: TagChip) => {
    if (liveWires(c).length) patchChip(c.id, { on: !c.on })
    else toggleTagFilter(c.tag)
  }
  /** Effects of every switched-on button; a wired frame passes its effect on to the notes inside. */
  const { noteFx, frameFx } = useMemo(() => {
    const nf = new Map<string, ObjectFx[]>()
    const ff = new Map<string, ObjectFx[]>()
    const add = (m: Map<string, ObjectFx[]>, id: string, fx: ObjectFx) => {
      const list = m.get(id) ?? []
      if (!list.some((x) => x.effect === fx.effect)) m.set(id, [...list, fx])
    }
    const noteIds = new Set(notes.map((n) => n.id))
    for (const c of chips) {
      if (!c.on || !c.targets?.length) continue
      const fx: ObjectFx = { effect: chipEffect(c), label: c.tag, color: CHIP_COLORS[c.color] ?? CHIP_COLORS.accent }
      for (const t of c.targets) {
        if (noteIds.has(t)) add(nf, t, fx)
        const f = frames.find((x) => x.id === t)
        if (f) {
          add(ff, f.id, fx)
          for (const n of frameContents(f)) add(nf, n.id, fx)
        }
      }
    }
    return { noteFx: nf, frameFx: ff }
  }, [chips, notes, frames, frameContents])

  const placeChip = (tag: string, color: ChipColor, at: Point, snap: boolean) => {
    const x = snap ? snapTo(at.x, gridStep) : at.x
    const y = snap ? snapTo(at.y, gridStep) : at.y
    const id = `chip-${Date.now().toString(36)}-${++noteCounter}`
    setChips((prev) => [...prev, { id, tag, color, x: Math.round(x), y: Math.round(y) }])
    setSelectedId(null)
    setSelectedChipId(id)
  }
  /** Button dropped from the panel: on a note → tag it; on empty canvas → a free button (Ctrl/⌘ = snap to grid). */
  const handleChipDrop = (d: ChipDrop) => {
    const el = document.elementFromPoint(d.clientX, d.clientY) as HTMLElement | null
    if (!el || el.closest('.side-panel, .command-dock, .top-bar, .ink-toolbar, .reset-view')) return
    const noteId = el.closest<HTMLElement>('[data-note-id]')?.dataset.noteId
    if (noteId) return addTagToNote(noteId, d.tag)
    if (!el.closest('.canvas-board')) return
    placeChip(d.tag, d.color, toWorld({ x: d.clientX - d.grabX, y: d.clientY - d.grabY }), d.snap)
  }
  /** Click on a panel button: drop it in the middle of the view (slightly offset so they don't stack). */
  const placeChipCenter = (tag: string, color: ChipColor) => {
    const c = toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const k = chips.length % 6
    placeChip(tag, color, { x: c.x - 50 + k * 14, y: c.y - 15 + k * 14 }, false)
  }

  const zoomPercent = Math.round(transform.scale * 100)
  useEffect(() => {
    if (active) onZoomChange?.(zoomPercent)
  }, [active, zoomPercent, onZoomChange])
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = { newNote: () => createNote('') }
  })
  const menuNote = menu ? notes.find((n) => n.id === menu.id) : undefined
  const frameMenuFrame = frameMenu ? frames.find((f) => f.id === frameMenu.id) : undefined
  const chipMenuChip = chipMenu ? chips.find((c) => c.id === chipMenu.id) : undefined

  return (
    <div className={`app-shell view-${viewMode}`} onContextMenu={frameContextMenu}>

      {viewMode === 'canvas' ? (
        <>
          <CanvasBoard
            notes={notes}
            connections={connections}
            transform={transform}
            selectedId={selectedId}
            selectedIds={selectedIds}
            radialKeyLabel={keyGlyph(radialKey)}
            onToggleSelect={toggleSelect}
            onSelectMany={selectMany}
            selectedConnectionId={selectedConnectionId}
            grid={settings.grid}
            theme={settings.theme}
            onSelectConnection={setSelectedConnectionId}
            onConnect={handleConnect}
            onCreateLinked={handleCreateLinked}
            onCreateAt={(p) => addNote('', { x: p.x - W / 2, y: p.y - 20 })}
            onResizeNote={handleResizeNote}
            onNoteContextMenu={openMenu}
            editing={editing}
            onStartEdit={(id, focus) => {
              setSelectedId(id)
              setEditing({ id, focus })
            }}
            onEndEdit={() => setEditing(null)}
            onUpdateNote={updateNote}
            activeFilterTags={activeTagFilters}
            graphMode={graphMode}
            noteFx={noteFx}
            groupSize={groupSize}
            extraSelected={[...groupSel.chips, ...groupSel.frames]}
            extraSelectables={[
              ...chips.map((c) => ({ id: c.id, x: c.x, y: c.y, width: 120, height: 32 })),
              ...frames.map((f) => ({ id: f.id, x: f.x, y: f.y, width: f.width, height: f.height, contain: true })),
            ]}
            onSelect={(id) => {
              setSelectedId(id)
              setSelectedFrameId(null)
              setSelectedChipId(null)
            }}
            gridStep={gridStep}
            chipLayer={
              chips.length ? (
                <TagChipLayer
                  chips={chips}
                  scale={transform.scale}
                  gridStep={gridStep}
                  counts={tagCounts}
                  activeFilters={activeTagFilters}
                  selectedId={selectedChipId}
                  selectedIds={groupSel.chips}
                  grouped={(id) => isGroupedRef.current(id)}
                  onSelect={(id) => {
                    if (id && isGroupedRef.current(id)) return // keep the multi-selection while it is dragged
                    setSelectedId(null)
                    setSelectedConnectionId(null)
                    setSelectedFrameId(null)
                    setSelectedChipId(id)
                  }}
                  onMove={(id, x, y) =>
                    isGroupedRef.current(id)
                      ? groupMoveToRef.current(id, x, y)
                      : setChips((prev) => prev.map((c) => (c.id === id ? { ...c, x, y } : c)))
                  }
                  onClick={triggerChip}
                  targets={wireTargets}
                  onWire={wireChip}
                  onCutWire={cutWire}
                  onContextMenu={(id, x, y) => setChipMenu({ id, x, y })}
                  onDelete={(id) => {
                    setChips((prev) => prev.filter((c) => c.id !== id))
                    setSelectedChipId((s) => (s === id ? null : s))
                  }}
                  onDropOnNote={(c, noteId) => addTagToNote(noteId, c.tag)}
                />
              ) : undefined
            }
            onMove={handleMove}
            onToggleChecklist={handleToggleChecklist}
            onPointerDown={(e) => {
              panPointer.current = e.pointerId
              startPan(e.clientX, e.clientY)
            }}
            onPointerMove={(e) => {
              if (panPointer.current === e.pointerId) panTo(e.clientX, e.clientY)
            }}
            onPointerUp={() => {
              panPointer.current = null
              endPan()
            }}
            onWheel={(e) => {
              const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
              const dx = e.deltaX * unit
              const dy = e.deltaY * unit
              if (e.shiftKey) {
                panBy(dx || dy, 0)
                return
              }
              // scroll / pinch = zoom (moving around = dragging the empty canvas).
              // Zoom origin: the centre of the visible board, or the cursor when «Масштаб під курсором» is on.
              // Each event's delta is converted smoothly; a mouse wheel's coarse steps are capped.
              const isMouseWheel = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy))
              const d = isMouseWheel ? Math.sign(dy) * Math.min(Math.abs(dy), 100) : dy
              const k = e.ctrlKey ? 0.011 : isMouseWheel ? 0.0022 : 0.0045
              const atCursor = settings.zoomToCursor
              zoomAt(atCursor ? e.clientX : window.innerWidth / 2, atCursor ? e.clientY : window.innerHeight / 2, -d * k)
            }}
            underlay={
              frames.length ? (
                <FrameLayer
                  frames={framesSorted}
                  counts={frameCounts}
                  scale={transform.scale}
                  selectedId={selectedFrameId}
                  selectedIds={groupSel.frames}
                  onSelect={selectFrame}
                  onPatch={patchFrame}
                  onDelete={deleteFrame}
                  onFit={fitFrame}
                  onDragStart={startFrameDrag}
                  onDrag={dragFrame}
                  onDragEnd={endFrameDrag}
                  onContextMenu={openFrameMenu}
                  fx={frameFx}
                />
              ) : undefined
            }
            overlay={strokes.length ? <InkLayer strokes={strokes} /> : undefined}
          >
            {drawing && (
              <InkCapture
                transform={transform}
                tool={inkPrefs.tool}
                color={inkPrefs.color}
                strokes={strokes}
                onAddStroke={addStroke}
                onEraseStart={() => {
                  eraseSnap.current = strokesRef.current
                }}
                onErase={eraseStrokes}
                onEraseEnd={() => {
                  eraseSnap.current = null
                }}
                onPanStart={(e) => {
                  panPointer.current = e.pointerId
                  startPan(e.clientX, e.clientY)
                }}
                onPanMove={(e) => {
                  if (panPointer.current === e.pointerId) panTo(e.clientX, e.clientY)
                }}
                onPanEnd={() => {
                  panPointer.current = null
                  endPan()
                }}
              />
            )}
          </CanvasBoard>

          {drawing && (
            <InkToolbar
              tool={inkPrefs.tool}
              color={inkPrefs.color}
              onTool={(tool) => setInkPrefs((p) => ({ ...p, tool }))}
              onColor={(color) => setInkPrefs((p) => ({ ...p, color }))}
              canUndo={historyLen > 0}
              hasStrokes={strokes.length > 0}
              onUndo={undoInk}
              onClear={clearInk}
              onDone={() => setDrawing(false)}
            />
          )}

          <SidePanel open={tagsOpen} title={tr('Теги')}>
            <TagPanel
              noteTags={noteTags}
              activeFilters={activeTagFilters}
              onToggleFilter={toggleTagFilter}
              onPlace={placeChipCenter}
              onDrop={handleChipDrop}
            />
          </SidePanel>

          <SidePanel open={vaultOpen} title={tr('Сховище')}>
            {notes.map((note) => (
              <button
                key={note.id}
                className={`side-panel__item${selectedId === note.id ? ' is-active' : ''}`}
                onClick={() => jumpTo(note)}
              >
                <span>{note.title}</span>
              </button>
            ))}
          </SidePanel>

          <CommandDock
            ref={dockInputRef}
            query={query}
            onQueryChange={setQuery}
            onSubmit={handleDockSubmit}
            onQuickNote={() => createNote('')}
            onToggleGraph={() => setGraphMode((v) => !v)}
            onToggleTags={() => setTagsOpen((v) => !v)}
            onToggleVault={() => setVaultOpen((v) => !v)}
            graphActive={graphMode}
            tagsActive={tagsOpen}
            vaultActive={vaultOpen}
            onToggleDraw={() => {
              setMenu(null)
              setDrawing((v) => !v)
            }}
            drawActive={drawing}
            onFrame={createFrame}
          />

          {/* rendered inside the pane (like the dock) so it slides with its own vault and shows that vault's zoom */}
          {zoomPercent !== 100 && (
            <button
              className="reset-view"
              title={tr('Скинути масштаб до 100%')}
              onClick={() => setScale(1, window.innerWidth / 2, window.innerHeight / 2)}
            >
              {zoomPercent}%
            </button>
          )}
        </>
      ) : (
        <NotesList
          notes={notes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateNote}
          onCreate={() => createNote('')}
          onDelete={deleteNote}
          onToggleChecklist={handleToggleChecklist}
          baseFontPx={settings.cardFontSize}
        />
      )}

      {searchOpen && (
      <QuickSearch
        open
        notes={notes}
        onPick={jumpTo}
        onCreate={(t) => createNote(t)}
        onClose={() => setSearchOpen(false)}
      />
      )}

      {menuNote && menu && viewMode === 'canvas' && (
        <NoteMenu
          key={menu.id + menu.x + menu.y}
          note={menuNote}
          at={menu}
          linkCount={connections.filter((c) => c.from === menuNote.id || c.to === menuNote.id).length}
          onClose={closeMenu}
          baseFontPx={settings.cardFontSize}
          autoTextDefault={settings.autoTextSize}
          onPatch={(patch) => updateNote(menuNote.id, patch)}
          onEdit={() => setEditing({ id: menuNote.id, focus: 'body' })}
          onDuplicate={() => duplicateNote(menuNote.id)}
          onCopyText={() => copyNoteText(menuNote.id)}
          onFront={() => reorderNote(menuNote.id, true)}
          onBack={() => reorderNote(menuNote.id, false)}
          onOpenInList={() => {
            setSelectedId(menuNote.id)
            setViewMode('list')
          }}
          onUnlink={() => setConnections((prev) => prev.filter((c) => c.from !== menuNote.id && c.to !== menuNote.id))}
          onDelete={() => deleteNote(menuNote.id)}
        />
      )}

      {frameMenu && frameMenuFrame && viewMode === 'canvas' && (
        <FrameMenu
          key={frameMenu.id + frameMenu.x + frameMenu.y}
          frame={frameMenuFrame}
          at={frameMenu}
          count={frameCounts.get(frameMenuFrame.id) ?? 0}
          onClose={closeFrameMenu}
          onPatch={(patch) => patchFrame(frameMenuFrame.id, patch)}
          onFit={() => fitFrame(frameMenuFrame.id)}
          onSelectNotes={() => selectMany(frameContents(frameMenuFrame).map((n) => n.id))}
          onDuplicate={() => duplicateFrame(frameMenuFrame.id)}
          onDelete={() => deleteFrame(frameMenuFrame.id)}
        />
      )}

      {chipMenu && chipMenuChip && viewMode === 'canvas' && (
        <ChipMenu
          key={chipMenu.id + chipMenu.x + chipMenu.y}
          chip={chipMenuChip}
          at={chipMenu}
          wireCount={liveWires(chipMenuChip).length}
          onClose={closeChipMenu}
          onPatch={(patch) => patchChip(chipMenuChip.id, patch)}
          onToggle={() => patchChip(chipMenuChip.id, { on: !chipMenuChip.on })}
          onUnwire={() => patchChip(chipMenuChip.id, { targets: [], on: false })}
          onDelete={() => {
            setChips((prev) => prev.filter((c) => c.id !== chipMenuChip.id))
            setSelectedChipId(null)
          }}
        />
      )}

      <RadialMenu keyGlyph={keyGlyph(radialKey)} center={radial} items={radialItems} active={radialActive} onHover={setRadialActive} onRun={runRadial} />
    </div>
  )
}
