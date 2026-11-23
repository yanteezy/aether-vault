/**
 * Earned shortcuts: when an action that has a key is done with the mouse a few times, Aether shows its key once
 * ("Tip: Ctrl+D duplicates"). Never again for that action, and never for an action the user already does by key.
 */
import { IS_MAC } from '../settings/settings'
import { readJson, writeJson } from './store'
import { showToast } from './toast'
import { t } from '../i18n'

const mod = () => (IS_MAC ? '⌘' : 'Ctrl+')
const TIPS: Record<string, () => [keys: string, what: string]> = {
  duplicate: () => [`${mod()}D`, t('дублює виділене')],
  delete: () => [IS_MAC ? '⌫' : 'Delete', t('видаляє виділене')],
  edit: () => ['Enter', t('відкриває нотатку для редагування')],
  draw: () => ['P', t('малювати; затисніть P — малювання лише поки тримаєте')],
  share: () => [IS_MAC ? '⇧⌘C' : 'Ctrl+Shift+C', t('одразу копіює посилання на дошку')],
  settings: () => [`${mod()},`, t('відкриває налаштування')],
  palette: () => [`${mod()}K`, t('усі дії та пошук нотаток')],
}
export type CoachAction = keyof typeof TIPS
const AFTER = 3
const KEY = 'coach'

interface CoachState {
  n: Record<string, number>
  done: string[]
}
const state = (): CoachState => {
  const s = readJson<CoachState>(KEY)
  return { n: s?.n ?? {}, done: s?.done ?? [] }
}
let shownThisSession = false

/** The action was done with the mouse. */
export function coachMouse(action: CoachAction) {
  const s = state()
  if (s.done.includes(action)) return
  s.n[action] = (s.n[action] ?? 0) + 1
  // at most one tip per launch, so they never pile up
  if (s.n[action] >= AFTER && !shownThisSession) {
    shownThisSession = true
    s.done.push(action)
    const [keys, what] = TIPS[action]()
    window.setTimeout(() => showToast({ id: 'tip', kind: 'tip', text: t('Порада: {keys} — {what}', { keys, what }), ms: 6000 }), 350)
  }
  try {
    writeJson(KEY, s)
  } catch {
    /* fine */
  }
}
/** The action was done with its key: nothing to teach. */
export function coachKey(action: CoachAction) {
  const s = state()
  if (s.done.includes(action)) return
  s.done.push(action)
  try {
    writeJson(KEY, s)
  } catch {
    /* fine */
  }
}
