import { useCallback, useEffect, useRef, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useT } from '../i18n'
import './UpdateNotice.css'

/** Event other parts of the UI fire for a manual check (Settings → About → «Перевірити»). */
export const CHECK_UPDATES_EVENT = 'aether:check-updates'
export const requestUpdateCheck = () => window.dispatchEvent(new CustomEvent(CHECK_UPDATES_EVENT))

/** Updates exist only inside the installed app (the browser simulator sets __AETHER_SIM__ to demo the flow). */
const canUpdate = () => typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__AETHER_SIM__' in window)

const AUTO_CHECK_DELAY = 4000

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; version: string; done: number; total: number | null }
  | { kind: 'restarting'; version: string }
  | { kind: 'latest' }
  | { kind: 'error'; message: string }

/** Online updates: silent check on launch, a card with release notes, progress, then relaunch. */
export function UpdateNotice({ currentVersion }: { currentVersion: string }) {
  const tr = useT()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const busy = useRef(false)

  const run = useCallback(async (manual: boolean) => {
    if (busy.current) return
    if (!canUpdate()) {
      if (manual) setState({ kind: 'error', message: tr('Оновлення доступні лише у встановленому застосунку') })
      return
    }
    busy.current = true
    if (manual) setState({ kind: 'checking' })
    try {
      const update = await check()
      if (update) setState({ kind: 'available', update })
      else setState(manual ? { kind: 'latest' } : { kind: 'idle' })
    } catch (e) {
      // the automatic check stays silent (offline, no release yet…)
      setState(manual ? { kind: 'error', message: String((e as Error)?.message ?? e) } : { kind: 'idle' })
    } finally {
      busy.current = false
    }
  }, [tr])

  useEffect(() => {
    const t = window.setTimeout(() => void run(false), AUTO_CHECK_DELAY)
    const onManual = () => void run(true)
    window.addEventListener(CHECK_UPDATES_EVENT, onManual)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener(CHECK_UPDATES_EVENT, onManual)
    }
  }, [run])

  // «you're up to date» fades away by itself
  useEffect(() => {
    if (state.kind !== 'latest') return
    const t = window.setTimeout(() => setState({ kind: 'idle' }), 3500)
    return () => window.clearTimeout(t)
  }, [state.kind])

  const install = async (update: Update) => {
    const version = update.version
    setState({ kind: 'downloading', version, done: 0, total: null })
    try {
      let done = 0
      let total: number | null = null
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? null
        else if (ev.event === 'Progress') done += ev.data.chunkLength
        setState({ kind: 'downloading', version, done, total })
      })
      setState({ kind: 'restarting', version })
      await relaunch()
    } catch (e) {
      setState({ kind: 'error', message: String((e as Error)?.message ?? e) })
    }
  }

  if (state.kind === 'idle') return null
  const close = () => setState({ kind: 'idle' })

  return (
    <div className="update-notice glass-panel-strong" role="status" aria-live="polite">
      <div className="update-notice__icon" aria-hidden>
        <svg viewBox="0 0 20 20" width="18" height="18">
          <path d="M10 3v9.5M5.8 8.6 10 12.8l4.2-4.2M4 15.5h12" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="update-notice__body">
        {state.kind === 'checking' && <div className="update-notice__title">{tr('Перевіряю оновлення…')}</div>}

        {state.kind === 'latest' && (
          <>
            <div className="update-notice__title">{tr('У вас остання версія')}</div>
            <div className="update-notice__text">Aether {currentVersion}</div>
          </>
        )}

        {state.kind === 'available' && (
          <>
            <div className="update-notice__title">{tr('Доступна версія {v}', { v: state.update.version })}</div>
            <div className="update-notice__text">{tr('Зараз встановлено {v}', { v: currentVersion })}</div>
            {state.update.body && <div className="update-notice__notes">{state.update.body}</div>}
            <div className="update-notice__actions">
              <button className="update-notice__btn is-primary" onClick={() => void install(state.update)}>
                {tr('Оновити')}
              </button>
              <button className="update-notice__btn" onClick={close}>
                {tr('Пізніше')}
              </button>
            </div>
          </>
        )}

        {state.kind === 'downloading' && (
          <>
            <div className="update-notice__title">{tr('Завантаження {v}…', { v: state.version })}</div>
            <div className="update-notice__bar">
              <span
                className={state.total ? '' : 'is-indeterminate'}
                style={state.total ? { width: `${Math.min(100, (state.done / state.total) * 100)}%` } : undefined}
              />
            </div>
            <div className="update-notice__text">
              {state.total ? `${Math.round((state.done / state.total) * 100)}%` : tr('Зачекайте…')}
            </div>
          </>
        )}

        {state.kind === 'restarting' && (
          <>
            <div className="update-notice__title">{tr('Оновлення встановлено')}</div>
            <div className="update-notice__text">{tr('Aether перезапускається — ваші нотатки на місці')}</div>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="update-notice__title">{tr('Не вдалося оновитися')}</div>
            <div className="update-notice__text">{tr('Перевірте з’єднання з інтернетом і спробуйте пізніше')}</div>
            <div className="update-notice__error">{state.message}</div>
            <div className="update-notice__actions">
              <button className="update-notice__btn" onClick={close}>
                {tr('Закрити')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
