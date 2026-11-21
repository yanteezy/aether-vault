import { EN } from '../i18n/en'
import { CHIP_COLORS, type ChipColor, type TagChip, type TagEffect } from '../types/note'

/** Every effect a button can apply (label/hint are Ukrainian source strings). */
export const TAG_EFFECTS: { id: TagEffect; label: string; hint: string }[] = [
  { id: 'important', label: 'Важливо', hint: 'Червоне пульсуюче світіння, поверх інших' },
  { id: 'idea', label: 'Ідея', hint: 'Тепле сяйво й лампочка' },
  { id: 'todo', label: 'Зробити', hint: 'Синій бігучий пунктир навколо' },
  { id: 'question', label: 'Питання', hint: 'Фіолетовий контур і знак питання в куті' },
  { id: 'done', label: 'Готово', hint: 'Відходить назад, під інші нотатки, і сіріє' },
  { id: 'private', label: 'Особисте', hint: 'Зміст закривається матовою шторкою' },
  { id: 'highlight', label: 'Підсвітка', hint: 'Світиться кольором кнопки' },
  { id: 'fade', label: 'Приглушити', hint: 'Стає майже прозорою' },
]

/** Ready-made buttons of the Tags panel: fixed colour and effect (tag is the Ukrainian source string). */
export const TAG_PRESETS: { tag: string; color: ChipColor; effect: TagEffect }[] = [
  { tag: 'важливо', color: 'red', effect: 'important' },
  { tag: 'ідея', color: 'amber', effect: 'idea' },
  { tag: 'зробити', color: 'blue', effect: 'todo' },
  { tag: 'питання', color: 'purple', effect: 'question' },
  { tag: 'готово', color: 'green', effect: 'done' },
  { tag: 'особисте', color: 'gray', effect: 'private' },
]

/** Ready-made button for a tag in either language (buttons store the translated label). */
export function presetFor(tag: string) {
  const t = tag.trim().toLowerCase()
  return TAG_PRESETS.find((p) => p.tag === t || (EN[p.tag] ?? '').toLowerCase() === t)
}

export const DEFAULT_CUSTOM_EFFECT: TagEffect = 'highlight'

export function chipEffect(c: Pick<TagChip, 'tag' | 'effect'>): TagEffect {
  return presetFor(c.tag)?.effect ?? c.effect ?? DEFAULT_CUSTOM_EFFECT
}

export const effectInfo = (id: TagEffect) => TAG_EFFECTS.find((e) => e.id === id) ?? TAG_EFFECTS[0]

/** One active effect on a note or frame: which, from which button. */
export interface ObjectFx {
  effect: TagEffect
  label: string
  color: string
}

export const fxColor = (c: ChipColor) => CHIP_COLORS[c]
