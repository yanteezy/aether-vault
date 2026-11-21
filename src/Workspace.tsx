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
import { THEMES, isRadialKey, keyGlyph, type AppSettings, type ThemeId } from './settings/settings'
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
import { importImage, isImageFile, type NoteImage } from './features/images'
import { describeLink, parseUrl } from './features/links'
import { CHIP_COLORS } from './types/note'
import { RadialIcon } from './components/RadialIcons'

let noteCounter = 1
const newId = () => `note-${Date.now()}-${++noteCounter}`
const W = 260
type GroupSel = { chips: string[]; frames: string[]; strokes: string[] }
const NO_GROUP: GroupSel = { chips: [], frames: [], strokes: [] }
const groupLen = (g: GroupSel) => g.chips.length + g.frames.length + g.strokes.length
let strokeSeq = 0
const newStrokeId = () => `ink-${Date.now().toString(36)}-${(++strokeSeq).toString(36)}`

/** Copied / cut objects — module level, so they can be pasted into another workspace tab too. */
type BoardClip = {
  notes: NoteCardData[]
  connections: Connection[]
  chips: TagChip[]
  frames: Frame[]
  strokes: InkStroke[]
  text: string
}
let boardClip: BoardClip | null = null
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
  /** Change the theme where it is set: this workspace's own theme, or the global one. */
  onSetTheme?: (theme: ThemeId) => void
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
  onSetTheme,
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
  const kindRef = useRef<{ chips: Set<string>; frames: Set<string>; strokes: Set<string> }>({ chips: new Set(), frames: new Set(), strokes: new Set() })
  /** Plain single selection: also drops any multi-selection. */
  const setSelectedId = useCallback((v: string | null | ((s: string | null) => string | null)) => {
    setMultiIds((m) => (m.length ? [] : m))
    setGroupSel((g) => (groupLen(g) ? NO_GROUP : g))
    setPrimaryId(v)
  }, [])
  const selectedIds = useMemo(
    () => new Set(multiIds.length ? multiIds : selectedId ? [selectedId] : []),
    [multiIds, selectedId],
  )
  const groupSize = selectedIds.size + groupLen(groupSel)
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  /** Replace the whole selection (box select, Ctrl+A): notes, buttons and frames. */
  const selectMany = useCallback((ids: string[]) => {
    const k = kindRef.current
    const chipIds = ids.filter((id) => k.chips.has(id))
    const frameIds = ids.filter((id) => k.frames.has(id))
    const strokeIds = ids.filter((id) => k.strokes.has(id))
    const noteIds = ids.filter((id) => !k.chips.has(id) && !k.frames.has(id) && !k.strokes.has(id))
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
    setGroupSel(chipIds.length || frameIds.length || strokeIds.length ? { chips: chipIds, frames: frameIds, strokes: strokeIds } : NO_GROUP)
    setSelectedFrameId(null)
    setSelectedChipId(null)
  }, [])
  /** Ctrl/⌘+click: add or remove one note, like icons on a desktop. */
  const toggleSelect = useCallback(
    (id: string) => {
      const g = groupSelRef.current
      const cur = [...selectedIdsRef.current, ...g.chips, ...g.frames, ...g.strokes]
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
  kindRef.current = { chips: new Set(chips.map((c) => c.id)), frames: new Set(frames.map((f) => f.id)), strokes: new Set(strokes.filter((st) => !st.note).map((st) => st.id)) }
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
  // (undo for drawings is the board-wide undo / redo below)
  /** Real on-screen height of a note (text can make it taller than its stored height). */
  const noteH = (n: NoteCardData) =>
    (document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(n.id)}"]`)?.offsetHeight ?? n.height)
  const addStroke = useCallback(
    (st: InkStroke) => {
      // drawn on top of a note → it becomes part of that note's background and travels with it
      const b = strokeBounds(st)
      const cx = (b.minX + b.maxX) / 2
      const cy = (b.minY + b.maxY) / 2
      const host = [...notesRef.current].reverse().find((n) => cx >= n.x && cx <= n.x + n.width && cy >= n.y && cy <= n.y + noteH(n))
      setStrokes((prev) => [...prev, host ? { ...st, note: host.id, x: st.x - host.x, y: st.y - host.y } : st])
    },
    [setStrokes],
  )
  const eraseStrokes = useCallback(
    (changes: Map<string, InkStroke[]>) => {
      // the eraser works on board coordinates; attached pieces go back to their note's coordinates
      const byId = new Map(notesRef.current.map((n) => [n.id, n]))
      setStrokes((prev) =>
        prev.flatMap((st) => {
          const left = changes.get(st.id)
          if (!left) return [st]
          return left.map((p) => {
            const n = p.note ? byId.get(p.note) : undefined
            return n ? { ...p, x: p.x - n.x, y: p.y - n.y } : p
          })
        }),
      )
    },
    [setStrokes],
  )
  const clearInk = useCallback(() => {
    if (!strokesRef.current.length) return
    setStrokes([])
  }, [setStrokes])

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
        if (st.note) continue // attached drawings travel with their note
        const b = strokeBounds(st)
        if (inside((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)) ss.set(st.id, { x: st.x, y: st.y })
      }
      // frames nested completely inside travel with their parent
      const fs = new Map<string, Point>()
      for (const o of frames)
        if (o.id !== id && !o.locked && inside(o.x, o.y) && inside(o.x + o.width, o.y + o.height)) fs.set(o.id, { x: o.x, y: o.y })
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
      setStrokes((prev) => (prev.some((st) => st.note === id) ? prev.filter((st) => st.note !== id) : prev))
      setPrimaryId((s) => (s === id ? null : s))
      setMultiIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : m))
    },
    [setNotes, setConnections],
  )
  /** Delete every selected note (one or many). */
  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current
    const g = groupSelRef.current
    if (!ids.size && !groupLen(g)) return
    setNotes((prev) => prev.filter((n) => !ids.has(n.id)))
    setStrokes((prev) => prev.filter((st) => !(st.note && ids.has(st.note)) && !g.strokes.includes(st.id)))
    setConnections((prev) => prev.filter((c) => !ids.has(c.from) && !ids.has(c.to)))
    if (g.chips.length) setChips((prev) => prev.filter((c) => !g.chips.includes(c.id)))
    if (g.frames.length) setFrames((prev) => prev.filter((f) => !g.frames.includes(f.id)))
    setPrimaryId(null)
    setMultiIds([])
    setGroupSel(NO_GROUP)
  },
    [setNotes, setConnections, setChips, setFrames, setStrokes],
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
      setStrokes((prev) => [...prev, ...prev.filter((st) => st.note === id).map((st) => ({ ...st, id: newStrokeId(), note: copy.id }))])
      setSelectedId(copy.id)
    },
    [notes, setNotes, setStrokes],
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
    const size = selectedIdsRef.current.size + groupLen(g)
    return size > 1 && (selectedIdsRef.current.has(id) || g.chips.includes(id) || g.frames.includes(id) || g.strokes.includes(id))
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
      if (st.note) continue // attached drawings travel with their note
      const b = strokeBounds(st)
      if (g.strokes.includes(st.id) || inSelFrame((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)) strokesM.set(st.id, { x: st.x, y: st.y })
    }
    const chipsM = new Map<string, Point>()
    for (const c of chipsRef.current) if (g.chips.includes(c.id)) chipsM.set(c.id, { x: c.x, y: c.y })
    const origin =
      notesM.get(lead) ?? chipsM.get(lead) ?? framesM.get(lead) ?? strokesM.get(lead) ?? { x: 0, y: 0 }
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

  // ---------- undo / redo: snapshots of the whole board ----------
  // Every action is one step. Changes are merged into the current step only while a pointer is
  // held (dragging, resizing, erasing) or while you keep typing in a note — so one drag or one
  // burst of typing undoes in one go, but Delete right after Ctrl+D stays two separate steps.
  type Snap = { notes: NoteCardData[]; connections: Connection[]; chips: TagChip[]; frames: Frame[]; strokes: InkStroke[] }
  const liveSnap: Snap = { notes, connections, chips, frames, strokes }
  const liveSnapRef = useRef(liveSnap)
  liveSnapRef.current = liveSnap
  const history = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] })
  /** Board state after the previous change (= «before» of the next one). */
  const prevSnap = useRef<Snap>(liveSnap)
  const burst = useRef<number | null>(null)
  const restoring = useRef(false)
  const pointerHeld = useRef(false)
  /** When the pointer was released: a drag's last frame can land a moment after pointerup. */
  const pointerUpAt = useRef(0)
  /** A new press of a pointer or a key (outside text fields) always starts a new undo step. */
  const newAction = useRef(false)
  const [, setHistoryTick] = useState(0)
  useEffect(() => {
    const down = () => {
      pointerHeld.current = true
      newAction.current = true
    }
    const up = () => {
      pointerHeld.current = false
      pointerUpAt.current = performance.now()
    }
    const key = (e: KeyboardEvent) => {
      if (!isTyping(e.target) && !['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) newAction.current = true
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])
  const sameSnap = (a: Snap, b: Snap) =>
    a.notes === b.notes && a.connections === b.connections && a.chips === b.chips && a.frames === b.frames && a.strokes === b.strokes
  useEffect(() => {
    const now = liveSnapRef.current
    if (restoring.current) {
      restoring.current = false
      prevSnap.current = now
      return
    }
    if (sameSnap(prevSnap.current, now)) return
    const merging =
      !newAction.current &&
      burst.current !== null &&
      (pointerHeld.current || performance.now() - pointerUpAt.current < 250 || isTyping(document.activeElement))
    newAction.current = false
    if (burst.current !== null) window.clearTimeout(burst.current)
    if (!merging) {
      const h = history.current
      h.past.push(prevSnap.current)
      if (h.past.length > 100) h.past.shift()
      h.future = []
      setHistoryTick((t) => t + 1)
    }
    burst.current = window.setTimeout(() => {
      burst.current = null
    }, 700)
    prevSnap.current = now
  }, [notes, connections, chips, frames, strokes])
  const applySnap = (snap: Snap) => {
    if (burst.current !== null) window.clearTimeout(burst.current)
    burst.current = null
    restoring.current = true
    setNotes(snap.notes)
    setConnections(snap.connections)
    setChips(snap.chips)
    setFrames(snap.frames)
    setStrokes(snap.strokes)
    setHistoryTick((t) => t + 1)
  }
  const undo = () => {
    const h = history.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(liveSnapRef.current)
    applySnap(prev)
  }
  const redo = () => {
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(liveSnapRef.current)
    applySnap(next)
  }
  const undoRef = useRef(undo)
  undoRef.current = undo
  const redoRef = useRef(redo)
  redoRef.current = redo
  const canUndo = history.current.past.length > 0


  // ---------- drawings: free ones on the board, attached ones inside their notes ----------
  const freeStrokes = useMemo(() => strokes.filter((st) => !st.note), [strokes])
  const noteInk = useMemo(() => {
    const m = new Map<string, InkStroke[]>()
    for (const st of strokes) if (st.note) m.set(st.note, [...(m.get(st.note) ?? []), st])
    return m
  }, [strokes])
  /** Every stroke in board coordinates (what the eraser and «fit all» work with). */
  const boardStrokes = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    return strokes.flatMap((st) => {
      if (!st.note) return [st]
      const n = byId.get(st.note)
      return n ? [{ ...st, x: st.x + n.x, y: st.y + n.y }] : []
    })
  }, [strokes, notes])

  /** Press on a free drawing: select it (Ctrl/⌘ adds), drag moves it — or the whole selection. */
  const onStrokeDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) return toggleSelect(id)
    if (!isGroupedRef.current(id) && !groupSelRef.current.strokes.includes(id)) selectMany([id])
    const sx = e.clientX
    const sy = e.clientY
    const k = transform.scale
    const st0 = strokesRef.current.find((st) => st.id === id)
    if (!st0) return
    let moved = false
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / k)
      const dy = Math.round((ev.clientY - sy) / k)
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      if (isGroupedRef.current(id)) groupMoveByRef.current(id, dx, dy)
      else setStrokes((prev) => prev.map((st) => (st.id === id ? { ...st, x: st0.x + dx, y: st0.y + dy } : st)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // ---------- photos ----------
  const [imageEditId, setImageEditId] = useState<string | null>(null)
  const patchNoteImage = useCallback(
    (id: string, patch: Partial<NoteImage>) =>
      setNotes((prev) => prev.map((n) => (n.id === id && n.image ? { ...n, image: { ...n.image, ...patch } } : n))),
    [setNotes],
  )
  /** Photo → background of an existing note. */
  const attachImage = async (noteId: string, file: Blob) => {
    try {
      const img = await importImage(file)
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? { ...n, image: { id: img.id, w: img.w, h: img.h, fit: 'cover', dim: n.title || n.body ? 0.35 : 0 }, updatedAt: Date.now() }
            : n,
        ),
      )
    } catch {
      /* not a readable picture */
    }
  }
  /** Photo → a new picture note sized to its proportions, centred on a board point. */
  const createImageNote = async (file: Blob, at: Point) => {
    try {
      const img = await importImage(file)
      const width = 320
      const height = Math.round(Math.max(120, Math.min(640, (width * img.h) / img.w)))
      const id = newId()
      setNotes((prev) => [
        ...prev,
        { id, title: '', tags: [], x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height, body: '', image: { id: img.id, w: img.w, h: img.h, fit: 'cover', dim: 0 }, updatedAt: Date.now() },
      ])
      setSelectedId(id)
    } catch {
      /* not a readable picture */
    }
  }
  /** Note menu → «Add photo…»: a file dialog that outlives the menu. */
  const pickImage = (noteId: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) void attachImage(noteId, f)
    }
    input.click()
  }
  const viewCenter = () => toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const pointerWorld = () => {
    const m = mouse.current
    const overBoard = m.y > 60 && m.y < window.innerHeight - 110
    return overBoard ? toWorld(m) : viewCenter()
  }

  // ---------- links ----------
  const createLinkNote = (u: URL, at: Point) => {
    const { link, title } = describeLink(u)
    const width = link.thumb ? 300 : 280
    const height = link.thumb ? 290 : 150
    const id = newId()
    setNotes((prev) => [
      ...prev,
      { id, title, tags: [], x: Math.round(at.x - width / 2), y: Math.round(at.y - 40), width, height, body: '', link, updatedAt: Date.now() },
    ])
    setSelectedId(id)
  }
  /** Plain text pasted on the board: first line → title, the rest → text. */
  const createTextNote = (text: string, at: Point) => {
    const lines = text.replace(/\r/g, '').split('\n')
    const title = lines[0].trim().slice(0, 120)
    const body = lines.slice(1).join('\n').trim()
    const id = newId()
    setNotes((prev) => [...prev, { id, title, tags: [], x: Math.round(at.x - W / 2), y: Math.round(at.y - 40), width: W, height: H, body, updatedAt: Date.now() }])
    setSelectedId(id)
  }

  // ---------- cut / copy / paste of board objects ----------
  /** What is selected right now (single or multi), with what belongs to it. */
  const collectSelection = (): BoardClip | null => {
    const g = groupSelRef.current
    const noteIds = new Set(selectedIdsRef.current)
    const frameIds = new Set([...g.frames, ...(selectedFrameId ? [selectedFrameId] : [])])
    const chipIds = new Set([...g.chips, ...(selectedChipId ? [selectedChipId] : [])])
    const strokeIds = new Set(g.strokes)
    const fs = framesRef.current.filter((f) => frameIds.has(f.id))
    // a copied frame takes its contents along, like when it is dragged
    for (const n of notesRef.current)
      if (fs.some((f) => n.x + n.width / 2 >= f.x && n.x + n.width / 2 <= f.x + f.width && n.y + n.height / 2 >= f.y && n.y + n.height / 2 <= f.y + f.height)) noteIds.add(n.id)
    const clipNotes = notesRef.current.filter((n) => noteIds.has(n.id))
    const clipChips = chipsRef.current.filter((c) => chipIds.has(c.id))
    const clipStrokes = strokesRef.current.filter((st) => strokeIds.has(st.id) || (st.note && noteIds.has(st.note)))
    if (!clipNotes.length && !fs.length && !clipChips.length && !clipStrokes.length) return null
    const text = clipNotes
      .map((n) => [n.title, n.link?.url, n.body].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n')
    return {
      notes: structuredClone(clipNotes),
      connections: connections.filter((c) => noteIds.has(c.from) && noteIds.has(c.to)),
      chips: structuredClone(clipChips),
      frames: structuredClone(fs),
      strokes: structuredClone(clipStrokes),
      text: text || `Aether · ${clipNotes.length + fs.length + clipChips.length + clipStrokes.length}`,
    }
  }
  /** Remove the copied objects from the board (the «cut» half of Ctrl+X). */
  const removeObjects = (clip: BoardClip) => {
    const ids = new Set([...clip.notes, ...clip.chips, ...clip.frames, ...clip.strokes].map((o) => o.id))
    setNotes((prev) => prev.filter((n) => !ids.has(n.id)))
    setConnections((prev) => prev.filter((c) => !ids.has(c.from) && !ids.has(c.to)))
    setChips((prev) => prev.filter((c) => !ids.has(c.id)))
    setFrames((prev) => prev.filter((f) => !ids.has(f.id)))
    setStrokes((prev) => prev.filter((st) => !ids.has(st.id) && !(st.note && ids.has(st.note))))
    setSelectedId(null)
    setSelectedChipId(null)
    setSelectedFrameId(null)
  }
  /** Paste a copy with fresh ids, centred on the pointer, and select it. */
  const pasteClip = (clip: BoardClip) => {
    const boxes = [
      ...clip.notes.map((n) => [n.x, n.y, n.x + n.width, n.y + n.height]),
      ...clip.frames.map((f) => [f.x, f.y, f.x + f.width, f.y + f.height]),
      ...clip.chips.map((c) => [c.x, c.y, c.x + 120, c.y + 32]),
      ...clip.strokes.filter((st) => !st.note).map((st) => {
        const b = strokeBounds(st)
        return [b.minX, b.minY, b.maxX, b.maxY]
      }),
    ]
    if (!boxes.length) return
    const cx = (Math.min(...boxes.map((b) => b[0])) + Math.max(...boxes.map((b) => b[2]))) / 2
    const cy = (Math.min(...boxes.map((b) => b[1])) + Math.max(...boxes.map((b) => b[3]))) / 2
    const at = pointerWorld()
    const dx = Math.round(at.x - cx)
    const dy = Math.round(at.y - cy)
    const map = new Map<string, string>()
    const stamp = Date.now().toString(36)
    let i = 0
    const fresh = (old: string, prefix: string) => {
      const id = `${prefix}-${stamp}-${(++i).toString(36)}`
      map.set(old, id)
      return id
    }
    const notesN = clip.notes.map((n) => ({ ...structuredClone(n), id: fresh(n.id, 'note'), x: n.x + dx, y: n.y + dy, locked: false, updatedAt: Date.now() }))
    const framesN = clip.frames.map((f) => ({ ...f, id: fresh(f.id, 'frame'), x: f.x + dx, y: f.y + dy, locked: false }))
    const chipsN = clip.chips.map((c) => ({
      ...c,
      id: fresh(c.id, 'chip'),
      x: c.x + dx,
      y: c.y + dy,
      on: false,
      targets: (c.targets ?? []).map((t) => map.get(t)).filter((t): t is string => !!t),
    }))
    const strokesN = clip.strokes.map((st) =>
      st.note
        ? { ...st, id: fresh(st.id, 'ink'), note: map.get(st.note) }
        : { ...st, id: fresh(st.id, 'ink'), x: st.x + dx, y: st.y + dy },
    )
    const connsN = clip.connections.map((c) => ({ ...c, id: fresh(c.id, 'conn'), from: map.get(c.from)!, to: map.get(c.to)! }))
    setNotes((prev) => [...prev, ...notesN])
    setFrames((prev) => [...prev, ...framesN])
    setChips((prev) => [...prev, ...chipsN])
    setStrokes((prev) => [...prev, ...strokesN])
    setConnections((prev) => [...prev, ...connsN])
    // kinds of the new ids must be known before selecting them
    for (const f of framesN) kindRef.current.frames.add(f.id)
    for (const c of chipsN) kindRef.current.chips.add(c.id)
    for (const st of strokesN) if (!st.note) kindRef.current.strokes.add(st.id)
    selectMany([...notesN, ...framesN, ...chipsN].map((o) => o.id).concat(strokesN.filter((st) => !st.note).map((st) => st.id)))
  }
  const clipRef = useRef({ collectSelection, removeObjects, pasteClip, createLinkNote, createTextNote, createImageNote, attachImage, pointerWorld })
  clipRef.current = { collectSelection, removeObjects, pasteClip, createLinkNote, createTextNote, createImageNote, attachImage, pointerWorld }

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
      ...boardStrokes.map((st) => {
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
  }, [notes, frames, boardStrokes, chips, fitRect])

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
        run: () => (onSetTheme ? onSetTheme(nextTheme.id) : patchSettings({ theme: nextTheme.id })),
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
  }, [settings.theme, viewMode, toWorld, radial, addNote, createNote, fitAll, setScale, setViewMode, patchSettings, onOpenSettings, selectedId, selectedConnectionId, setConnections, deleteSelected, onSwitchTab, tabCount, tr, selectedChipId, setChips, groupSize, onSetTheme])

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
  const pasteFallback = useRef<number | undefined>(undefined)
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
      const mod = e.metaKey || e.ctrlKey
      // physical keys (e.code), so shortcuts work on any keyboard layout (Ukrainian «в» is still KeyD)
      if (mod && e.code === 'KeyK') {
        e.preventDefault()
        if (viewMode === 'canvas') {
          dockInputRef.current?.focus()
          dockInputRef.current?.select()
        } else setSearchOpen(true)
        return
      }
      if (typing || overlayOpen) return
      // undo / redo — any change on the board, also while drawing (text fields keep their own undo)
      if (mod && (e.code === 'KeyZ' || e.code === 'KeyY') && viewMode === 'canvas') {
        e.preventDefault()
        if (e.code === 'KeyY' || e.shiftKey) redoRef.current()
        else undoRef.current()
        return
      }
      if (drawing && viewMode === 'canvas') {
        const k = e.code === 'KeyP' ? 'p' : e.code === 'KeyM' ? 'm' : e.code === 'KeyE' ? 'e' : ''
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
      if (mod && e.code === 'KeyD') {
        e.preventDefault()
        if (selectedId && viewMode === 'canvas') duplicateNote(selectedId)
        return
      }
      // Ctrl+C / Ctrl+X: copy / cut the selected notes, buttons, frames and drawings
      if (mod && (e.code === 'KeyC' || e.code === 'KeyX') && viewMode === 'canvas') {
        const clip = clipRef.current.collectSelection()
        if (!clip) return
        e.preventDefault()
        boardClip = clip
        void navigator.clipboard?.writeText(clip.text).catch(() => {})
        if (e.code === 'KeyX') clipRef.current.removeObjects(clip)
        return
      }
      // Ctrl+V: the 'paste' event below decides (photo / link / text / copied objects);
      // if the system doesn't send one, paste the copied objects ourselves
      if (mod && e.code === 'KeyV' && viewMode === 'canvas') {
        window.clearTimeout(pasteFallback.current)
        pasteFallback.current = window.setTimeout(() => {
          if (boardClip) clipRef.current.pasteClip(boardClip)
        }, 120)
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
      if (mod && e.code === 'KeyA' && viewMode === 'canvas') {
        e.preventDefault()
        selectMany([
          ...notesRef.current.map((n) => n.id),
          ...chipsRef.current.map((c) => c.id),
          ...framesRef.current.map((f) => f.id),
          ...strokesRef.current.filter((st) => !st.note).map((st) => st.id),
        ])
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
        } else if ((selectedId || groupLen(groupSelRef.current)) && viewMode === 'canvas') deleteSelected()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (!isRadialKey(e, radialKey) || !radialRef.current.radial) return
      e.preventDefault()
      runRadial(radialRef.current.radialActive)
    }
    const blur = () => setRadial(null)
    /** Ctrl+V: a photo, a link, plain text or the objects copied with Ctrl+C / Ctrl+X. */
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || overlayOpen || viewMode !== 'canvas') return
      window.clearTimeout(pasteFallback.current)
      const c = clipRef.current
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
      if (files.length) {
        e.preventDefault()
        if (selectedId && files.length === 1) void c.attachImage(selectedId, files[0])
        else files.forEach((f, i) => { const p = c.pointerWorld(); void c.createImageNote(f, { x: p.x + i * 40, y: p.y + i * 40 }) })
        return
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (boardClip && (!text || text === boardClip.text)) {
        e.preventDefault()
        c.pasteClip(boardClip)
        return
      }
      const url = parseUrl(text)
      if (url) {
        e.preventDefault()
        c.createLinkNote(url, c.pointerWorld())
        return
      }
      if (text.trim()) {
        e.preventDefault()
        c.createTextNote(text, c.pointerWorld())
      }
    }
    /**
     * A text field (e.g. the dock's search) kept the keyboard focus after a click elsewhere,
     * so every shortcut thought you were typing. Clicking outside a field now gives the focus back.
     */
    const releaseFocus = (e: PointerEvent) => {
      const a = document.activeElement as HTMLElement | null
      const t = e.target as HTMLElement | null
      if (!a || a === document.body || !isTyping(a) || !t || a.contains(t) || isTyping(t)) return
      const ownNote = a.closest('[data-note-id]')
      if (ownNote && ownNote.contains(t)) return
      a.blur()
    }
    window.addEventListener('paste', paste)
    window.addEventListener('pointerdown', releaseFocus, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('paste', paste)
      window.removeEventListener('pointerdown', releaseFocus, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [active, overlayOpen, viewMode, selectedId, selectedConnectionId, setConnections, deleteSelected, selectMany, radialKey, runRadial, duplicateNote, menu, drawing, setInkPrefs, selectedFrameId, deleteFrame, selectedChipId, setChips, frameMenu, chipMenu])

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
    <div
      className={`app-shell view-${viewMode}`}
      onContextMenu={frameContextMenu}
      onDragOver={(e) => {
        // photos dragged in from Finder / Explorer
        if (viewMode === 'canvas' && [...e.dataTransfer.items].some((i) => i.kind === 'file')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files].filter(isImageFile)
        if (!files.length || viewMode !== 'canvas') return
        e.preventDefault()
        const noteId = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId
        if (noteId && files.length === 1) return void attachImage(noteId, files[0])
        const p = toWorld({ x: e.clientX, y: e.clientY })
        files.forEach((f, i) => void createImageNote(f, { x: p.x + i * 40, y: p.y + i * 40 }))
      }}
    >

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
            onRemoveConnection={(id) => {
              setConnections((prev) => prev.filter((c) => c.id !== id))
              setSelectedConnectionId((s) => (s === id ? null : s))
            }}
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
            extraSelected={[...groupSel.chips, ...groupSel.frames, ...groupSel.strokes]}
            extraSelectables={[
              ...chips.map((c) => ({ id: c.id, x: c.x, y: c.y, width: 120, height: 32 })),
              ...frames.map((f) => ({ id: f.id, x: f.x, y: f.y, width: f.width, height: f.height, contain: true })),
              ...freeStrokes.map((st) => {
                const b = strokeBounds(st)
                return { id: st.id, x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }
              }),
            ]}
            noteInk={noteInk}
            imageEditId={imageEditId}
            onImagePatch={patchNoteImage}
            onImageEditEnd={() => setImageEditId(null)}
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
            overlay={
              freeStrokes.length ? (
                <InkLayer strokes={freeStrokes} selected={groupSel.strokes} onStrokeDown={drawing ? undefined : onStrokeDown} />
              ) : undefined
            }
          >
            {drawing && (
              <InkCapture
                transform={transform}
                tool={inkPrefs.tool}
                color={inkPrefs.color}
                strokes={boardStrokes}
                onAddStroke={addStroke}
                onEraseStart={() => {}}
                onErase={eraseStrokes}
                onEraseEnd={() => {}}
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
              canUndo={canUndo}
              hasStrokes={strokes.length > 0}
              onUndo={undo}
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
          onPickImage={() => pickImage(menuNote.id)}
          onEditImage={() => setImageEditId(menuNote.id)}
          onImagePatch={(patch) => patchNoteImage(menuNote.id, patch)}
          onRemoveImage={() => updateNote(menuNote.id, { image: undefined })}
          inkCount={noteInk.get(menuNote.id)?.length ?? 0}
          onDetachInk={() =>
            setStrokes((prev) => prev.map((st) => (st.note === menuNote.id ? { ...st, note: undefined, x: st.x + menuNote.x, y: st.y + menuNote.y } : st)))
          }
          onDeleteInk={() => setStrokes((prev) => prev.filter((st) => st.note !== menuNote.id))}
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
