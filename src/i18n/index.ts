import { createContext, useContext } from 'react'
import { EN } from './en'

/**
 * Tiny i18n: the Ukrainian source string is the key, `EN` maps it to English.
 * Placeholders: `{name}` → vars.name. Missing English entries fall back to Ukrainian.
 */
export type Lang = 'uk' | 'en'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'uk', label: 'Українська' },
  { id: 'en', label: 'English' },
]

let current: Lang = 'uk'

export function setLang(lang: Lang) {
  current = lang === 'en' ? 'en' : 'uk'
  if (typeof document !== 'undefined') document.documentElement.lang = current
}
export const getLang = () => current

export function t(s: string, vars?: Record<string, string | number>): string {
  let out = current === 'en' ? (EN[s] ?? s) : s
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]))
  return out
}

/** Default language for a fresh install: Ukrainian unless the system is clearly something else. */
export function systemLang(): Lang {
  const l = (typeof navigator !== 'undefined' && navigator.language) || 'uk'
  return /^(uk|ru|be)/i.test(l) ? 'uk' : 'en'
}

export const LangContext = createContext<Lang>('uk')

/** Subscribes the component to language changes (works through React.memo). */
export function useT() {
  useContext(LangContext)
  return t
}
