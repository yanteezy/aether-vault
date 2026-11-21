import type { Connection, Frame, InkColor, InkStroke, NoteCardData, TagChip } from '../types/note'
import type { Lang } from '../i18n'
import { IS_MAC, keyLabel } from '../settings/settings'

/**
 * Default canvas of a fresh install (and of «Settings → Guide»): notes that explain
 * every feature, a frame, a few links, hand-drawn doodles and tag buttons.
 */
export interface GuideContent {
  notes: NoteCardData[]
  connections: Connection[]
  strokes: InkStroke[]
  frames: Frame[]
  chips: TagChip[]
}

/** Ids of the old demo notes (Project Cosmos…) — replaced by the guide if untouched. */
export const OLD_DEMO_IDS = new Set([
  'project-cosmos',
  'design-philosophy',
  'technical-specs',
  'meeting-notes',
  'ai-ethics',
  'reading-list',
  'quantum-entanglement',
  'magantum-entanglement',
])

// ---------- hand-drawn doodles (deterministic jitter so it looks drawn, not generated) ----------

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296 - 0.5
  }
}

function stroke(id: string, color: InkColor, pts: [number, number][], tool: 'pen' | 'marker' = 'pen', jitter = 1.2, seed = 1): InkStroke {
  const r = rng(seed)
  const x0 = pts[0][0]
  const y0 = pts[0][1]
  const points: number[] = []
  for (const [x, y] of pts) points.push(Math.round((x - x0 + r() * jitter) * 10) / 10, Math.round((y - y0 + r() * jitter) * 10) / 10)
  return { id, tool, color, points, x: x0, y: y0 }
}

/** Quadratic curve sampled into points. */
function curve(a: [number, number], c: [number, number], b: [number, number], n = 18): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]])
  }
  return out
}

/** Arrow: curved shaft + two-stroke head at `b`. */
function arrow(id: string, color: InkColor, a: [number, number], c: [number, number], b: [number, number], seed: number): InkStroke[] {
  const shaft = curve(a, c, b)
  const [px, py] = shaft[shaft.length - 3]
  const ang = Math.atan2(b[1] - py, b[0] - px)
  const len = 16
  const wing = (s: number): [number, number] => [b[0] - len * Math.cos(ang + s), b[1] - len * Math.sin(ang + s)]
  return [
    stroke(id, color, shaft, 'pen', 1.4, seed),
    stroke(id + '-h', color, [wing(0.5), b, wing(-0.5)], 'pen', 0.8, seed + 7),
  ]
}

function star(id: string, color: InkColor, cx: number, cy: number, r: number, seed: number): InkStroke {
  const pts: [number, number][] = []
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return stroke(id, color, pts, 'pen', 1, seed)
}

/** Four-point sparkle. */
function sparkle(id: string, color: InkColor, cx: number, cy: number, r: number, seed: number): InkStroke {
  const pts: [number, number][] = []
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4
    const rr = i % 2 ? r * 0.22 : r
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return stroke(id, color, pts, 'pen', 0.6, seed)
}

/** Loose hand-drawn ellipse that overshoots its start, like a pen circling something. */
function circleAround(id: string, color: InkColor, cx: number, cy: number, rx: number, ry: number, seed: number): InkStroke {
  const r = rng(seed)
  const pts: [number, number][] = []
  for (let i = 0; i <= 40; i++) {
    const a = -2.4 + (i / 40) * Math.PI * 2.15
    const k = 1 + r() * 0.05
    pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)])
  }
  return stroke(id, color, pts, 'pen', 0.6, seed)
}

/** Infinity loop — a nod to the Aether ribbon logo. */
function infinity(id: string, color: InkColor, cx: number, cy: number, w: number, seed: number): InkStroke {
  const pts: [number, number][] = []
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2
    const d = 1 + Math.sin(t) ** 2
    pts.push([cx + (w * Math.cos(t)) / d, cy + (w * 0.9 * Math.sin(t) * Math.cos(t)) / d])
  }
  return stroke(id, color, pts, 'pen', 0.5, seed)
}

function wave(id: string, color: InkColor, x0: number, x1: number, y: number, seed: number, tool: 'pen' | 'marker' = 'pen'): InkStroke {
  const pts: [number, number][] = []
  const n = Math.max(8, Math.round((x1 - x0) / 14))
  for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y + Math.sin(i * 1.3) * (tool === 'marker' ? 1.5 : 3)])
  return stroke(id, color, pts, tool, 0.8, seed)
}

// ---------- content ----------

export function guideContent(lang: Lang, radialKey = 'Alt'): GuideContent {
  const L = (uk: string, en: string) => (lang === 'en' ? en : uk)
  const mod = IS_MAC ? '⌘' : 'Ctrl'
  const alt = keyLabel(radialKey)
  const now = Date.now()
  const tBasics = L('основи', 'basics')
  const tImportant = L('важливо', 'important')
  const tTodo = L('зробити', 'todo')

  const note = (n: Omit<NoteCardData, 'updatedAt' | 'tags'> & { tags?: string[] }): NoteCardData => ({
    tags: [],
    updatedAt: now,
    ...n,
  })

  const notes: NoteCardData[] = [
    note({
      id: 'guide-welcome',
      title: L('Ласкаво просимо до Aether', 'Welcome to Aether'),
      style: 'headline',
      color: 'accent',
      x: 80,
      y: 110,
      width: 620,
      height: 200,
      body: L(
        'Це нескінченне полотно для ваших думок. Нотатки довкола розповідають про всі можливості — рухайте їх, редагуйте або видаліть, коли розберетеся. Посібник завжди можна відкрити знову: Налаштування → Загальні → Посібник.',
        'An infinite canvas for your thoughts. The notes around explain every feature — move them, edit them or delete them once you are comfortable. You can always reopen this guide: Settings → General → Guide.',
      ),
    }),
    note({
      id: 'guide-steps',
      title: L('Перші кроки', 'First steps'),
      color: 'yellow',
      tags: [tTodo],
      x: 800,
      y: 70,
      width: 300,
      height: 250,
      checklist: [
        { id: 's1', label: L('Двічі клацніть по полотну — нова нотатка', 'Double-click the canvas to add a note'), done: false },
        { id: 's2', label: L('З’єднайте дві нотатки лінією', 'Link two notes with a line'), done: false },
        { id: 's3', label: L(`Затисніть ${alt} — кругове меню`, `Hold ${alt} for the radial menu`), done: false },
        { id: 's4', label: L('Намалюйте щось у режимі «Малювати»', 'Draw something in Draw mode'), done: false },
        { id: 's5', label: L('Перетягніть кнопку-тег на полотно', 'Drag a tag button onto the canvas'), done: false },
      ],
    }),
    note({
      id: 'guide-look',
      title: L('Оформлення', 'Appearance'),
      style: 'bullets',
      color: 'purple',
      x: 1160,
      y: 70,
      width: 300,
      height: 250,
      body: L(
        `Налаштування — ${mod}+, або шестерня вгорі\nТеми: Скло, Світла, Дошка детектива, Креслення, Монохром\nАкцентний колір, сітка, розмір тексту, анімації\nМова інтерфейсу: українська або English`,
        `Settings — ${mod}+, or the gear at the top\nThemes: Glass, Light, Detective board, Blueprint, Mono\nAccent colour, grid, text size, animations\nInterface language: Ukrainian or English`,
      ),
    }),
    note({
      id: 'guide-notes',
      title: L('Нотатки', 'Notes'),
      style: 'bullets',
      tags: [tBasics],
      x: 80,
      y: 430,
      width: 300,
      height: 350,
      body: L(
        'Подвійний клік по порожньому місцю — нова нотатка\nПодвійний клік або Enter — редагувати\nТягніть, щоб перемістити; кут — змінити розмір\nПравий клік — тип, колір, розмір, закріплення\nПишіть #теги в полі тегів у вигляді «Нотатки»',
        'Double-click empty space for a new note\nDouble-click or Enter to edit\nDrag to move; the corner grip resizes\nRight-click for style, colour, size, pinning\nAdd #tags in the tags field of the Notes view',
      ),
    }),
    note({
      id: 'guide-links',
      title: L('Зв’язки', 'Links'),
      style: 'bullets',
      tags: [tBasics],
      x: 440,
      y: 430,
      width: 300,
      height: 350,
      body: L(
        'Наведіть на край нотатки — з’явиться «+»\nПотягніть «+» на іншу нотатку — буде лінія\nКлік по «+» — нова пов’язана нотатка\nКлік по лінії й Delete — прибрати зв’язок\n«Граф» у доку підсвічує зв’язки виділеної',
        'Hover a note edge to reveal a «+»\nDrag the «+» onto another note to link them\nClick the «+» for a new linked note\nClick a line and press Delete to remove it\n«Graph» in the dock highlights links of the selection',
      ),
    }),
    note({
      id: 'guide-nav',
      title: L('Навігація', 'Navigation'),
      style: 'bullets',
      tags: [tBasics],
      x: 800,
      y: 430,
      width: 300,
      height: 350,
      body: L(
        'Тягніть порожнє місце — рух полотна\nКолесо, щипок чи два пальці — масштаб\n⇧ + колесо — прокрутка вбік\nВкладки вгорі — окремі сховища, «+» додає нове\n«Полотно / Нотатки» — два вигляди одних даних',
        'Drag empty space to move around\nWheel, pinch or two fingers to zoom\n⇧ + wheel scrolls sideways\nTabs at the top are separate vaults, «+» adds one\n«Canvas / Notes» — two views of the same notes',
      ),
    }),
    note({
      id: 'guide-search',
      title: L('Швидкий пошук', 'Quick search'),
      style: 'bullets',
      tags: [tBasics],
      x: 1160,
      y: 430,
      width: 300,
      height: 350,
      body: L(
        `Пробіл — пошук по всіх нотатках\nВведіть назву, якої немає, — Enter створить нотатку\n${mod}+K — поле пошуку в доку внизу\n${mod}+D — дублювати виділену нотатку`,
        `Space opens search across all notes\nType a title that doesn't exist — Enter creates it\n${mod}+K focuses the search field in the dock\n${mod}+D duplicates the selected note`,
      ),
    }),
    note({
      id: 'guide-radial',
      title: L('Кругове меню', 'Radial menu'),
      style: 'bullets',
      color: 'blue',
      tags: [tImportant],
      x: 80,
      y: 830,
      width: 300,
      height: 380,
      body: L(
        `Затисніть ${alt} — довкола курсора з’являться дії\nНаведіть на дію й відпустіть клавішу\nНова нотатка тут, пошук, тема, масштаб, вкладки\nКлавішу можна змінити: Налаштування → Гарячі клавіші`,
        `Hold ${alt} — actions appear around the cursor\nPoint at one and release the key\nNew note here, search, theme, zoom, tabs\nChange the key in Settings → Shortcuts`,
      ),
    }),
    note({
      id: 'guide-select',
      title: L('Виділення', 'Selection'),
      style: 'bullets',
      color: 'blue',
      tags: [tImportant],
      x: 440,
      y: 830,
      width: 300,
      height: 380,
      body: L(
        `${mod} + клік — додати чи прибрати нотатку\n${mod} + тягнути по полотну — виділити рамкою\nТягніть будь-яку виділену — рухається вся група\n${mod}+A — усе, Delete — видалити, Esc — зняти\nУтримуйте ${mod} під час перетягування — прилипання до сітки`,
        `${mod} + click adds or removes a note\n${mod} + drag on the canvas draws a selection box\nDrag any selected note to move the whole group\n${mod}+A selects all, Delete removes, Esc clears\nHold ${mod} while dragging to snap to the grid`,
      ),
    }),
    note({
      id: 'guide-draw',
      title: L('Малювання і рамки', 'Drawing & frames'),
      style: 'bullets',
      color: 'green',
      x: 800,
      y: 830,
      width: 300,
      height: 380,
      body: L(
        `«Малювати» в доку: ручка P, маркер M, гумка E\n${mod}+Z — скасувати штрих, Esc — готово\n«Рамка» обгортає виділені нотатки групою\nРамка тягне за собою вміст; двічі клацніть назву`,
        `«Draw» in the dock: pen P, marker M, eraser E\n${mod}+Z undoes a stroke, Esc finishes\n«Frame» wraps the selected notes into a group\nA frame carries its contents; double-click its title`,
      ),
    }),
    note({
      id: 'guide-tags',
      title: L('Теги й кнопки', 'Tags & buttons'),
      style: 'bullets',
      color: 'pink',
      tags: [tImportant],
      x: 1160,
      y: 830,
      width: 300,
      height: 380,
      body: L(
        `«Теги» в доку — готові кнопки й теги нотаток\nПеретягніть кнопку на полотно — вона стане вільно\nЗ ${mod} під час перетягування — прилипне до сітки\nКинете на нотатку — нотатка отримає цей тег\nКлік по кнопці — показати лише нотатки з тегом`,
        `«Tags» in the dock — ready buttons and your note tags\nDrag a button onto the canvas — it lands freely\nHold ${mod} while dragging to snap it to the grid\nDrop it on a note to tag that note\nClick a button to show only notes with its tag`,
      ),
    }),
  ]

  const connections: Connection[] = [
    { id: 'guide-c1', from: 'guide-welcome', to: 'guide-steps', fromSide: 'right', toSide: 'left' },
    { id: 'guide-c2', from: 'guide-notes', to: 'guide-links', fromSide: 'right', toSide: 'left' },
    { id: 'guide-c3', from: 'guide-radial', to: 'guide-select', fromSide: 'right', toSide: 'left' },
  ]

  const frames: Frame[] = [
    { id: 'guide-frame', title: L('Почніть тут', 'Start here'), x: 50, y: 40, width: 680, height: 300, color: 'cyan' },
  ]

  const strokes: InkStroke[] = [
    // arrow from the welcome card down to the first how-to notes
    ...arrow('guide-ink-a1', 'cyan', [300, 352], [200, 372], [215, 418], 11),
    // second arrow towards links
    ...arrow('guide-ink-a2', 'cyan', [470, 352], [560, 366], [575, 418], 23),
    // sparkles & star around the title
    sparkle('guide-ink-s1', 'amber', 742, 66, 13, 31),
    sparkle('guide-ink-s2', 'amber', 766, 98, 7, 37),
    star('guide-ink-st', 'lavender', 1128, 372, 13, 41),
    // the Aether infinity ribbon, doodled
    infinity('guide-ink-inf', 'lavender', 1300, 375, 46, 43),
    // hand-drawn underline below the frame title area
    wave('guide-ink-u', 'mint', 96, 300, 345, 47),
    // circle around the tag buttons + arrow from the tags note
    circleAround('guide-ink-o', 'chalk', 1310, 1296, 128, 90, 53),
    ...arrow('guide-ink-a3', 'amber', [1490, 1120], [1545, 1190], [1432, 1240], 59),
    // highlighter swoosh under the selection note
    wave('guide-ink-m', 'cyan', 450, 730, 1226, 61, 'marker'),
  ]

  const chips: TagChip[] = [
    // switch-style buttons are wider: stacked in a column inside the circle
    { id: 'guide-chip-1', tag: tImportant, color: 'red', x: 1228, y: 1236 },
    { id: 'guide-chip-2', tag: tBasics, color: 'blue', x: 1228, y: 1280 },
    { id: 'guide-chip-3', tag: tTodo, color: 'amber', x: 1228, y: 1324 },
  ]

  return { notes, connections, strokes, frames, chips }
}

/** World bounds of the guide, used to fit it on first open. */
export const GUIDE_BOUNDS = { x: 40, y: 30, width: 1560, height: 1370 }

/**
 * The interface language changed: re-translate the guide objects the user hasn't edited.
 * Only text is swapped (titles, bodies, tags, checklist labels, frame title, button tags);
 * positions, sizes, colours and ticks stay. Anything that differs from the original text is left alone.
 */
export function translateGuide(
  state: { notes: NoteCardData[]; frames: Frame[]; chips: TagChip[] },
  from: Lang,
  to: Lang,
  radialKey = 'Alt',
) {
  const A = guideContent(from, radialKey)
  const B = guideContent(to, radialKey)
  const tagMap = new Map<string, string>()
  A.notes.forEach((n, i) => n.tags.forEach((t, j) => tagMap.set(t, B.notes[i].tags[j])))
  A.chips.forEach((c, i) => tagMap.set(c.tag, B.chips[i].tag))
  const swapTags = (tags: string[]) => tags.map((t) => tagMap.get(t) ?? t)
  let changed = false

  const notes = state.notes.map((n) => {
    const i = A.notes.findIndex((a) => a.id === n.id)
    if (i < 0) return n
    const a = A.notes[i]
    const b = B.notes[i]
    const sameText = n.title === a.title && (n.body ?? '') === (a.body ?? '')
    const sameList =
      (n.checklist?.length ?? 0) === (a.checklist?.length ?? 0) &&
      (n.checklist ?? []).every((it, k) => it.label === a.checklist![k].label)
    if (!sameText || !sameList) return n
    changed = true
    return {
      ...n,
      title: b.title,
      body: b.body,
      tags: swapTags(n.tags),
      checklist: n.checklist?.map((it, k) => ({ ...it, label: b.checklist![k].label })),
    }
  })
  const frames = state.frames.map((f) => {
    const i = A.frames.findIndex((a) => a.id === f.id)
    if (i < 0 || f.title !== A.frames[i].title) return f
    changed = true
    return { ...f, title: B.frames[i].title }
  })
  const chips = state.chips.map((c) => {
    const i = A.chips.findIndex((a) => a.id === c.id)
    if (i < 0 || c.tag !== A.chips[i].tag) return c
    changed = true
    return { ...c, tag: B.chips[i].tag }
  })
  return changed ? { notes, frames, chips } : null
}
