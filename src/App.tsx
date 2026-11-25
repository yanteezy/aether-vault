import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitTransform, Workspace, type WorkspaceApi } from './Workspace'
import { TopBar, type ViewMode } from './components/TopBar'
import { SettingsModal } from './components/SettingsModal'
import { SplashScreen, shouldShowSplash } from './components/SplashScreen'
import { UpdateNotice } from './components/UpdateNotice'
import { LanguagePicker } from './components/LanguagePicker'
import pkg from '../package.json'
import { applySettings, DEFAULT_SETTINGS, type AppSettings, type CanvasBg, type ThemeId } from './settings/settings'
import { usePersistentState } from './hooks/usePersistentState'
import { DEFAULT_VAULT_ID, deleteVaultData } from './hooks/vaultKeys'
import type { Vault } from './types/note'
import { LangContext, setLang, t } from './i18n'
import { OLD_DEMO_IDS } from './data/guide'
import { collectUnusedImages } from './features/images'
import { parseShareLink, type SharedBoard, type ShareToken } from './features/share'
import { ShareMenu } from './components/ShareMenu'
import { ShareOpenDialog } from './components/ShareOpenDialog'
import { FirstHints } from './components/FirstHints'
import { getVaultBackend } from './features/vaultRepo'
import { getItem, removeItem, setItem } from './features/store'
import { showToast } from './features/toast'
import { coachKey, coachMouse } from './features/coach'
import { Toast } from './components/Toast'
import { SaveStatusBanner } from './components/SaveStatusBanner'
import { UnreadableNotice } from './components/UnreadableNotice'
import { hasPreImport, IMPORT_DONE, revertImport } from './features/backup'
import './App.css'

/**
 * One-time upgrade: the old sample notes (Project Cosmos…) are replaced by the feature guide
 * when the first vault still holds only those samples.
 */
function migrateOldDemo() {
  const P = 'aethel-vault:'
  try {
    if (getItem(P + 'guide-migrated')) return
    setItem(P + 'guide-migrated', '1')
    const raw = getItem(P + 'notes')
    if (!raw) return
    const notes = JSON.parse(raw) as { id: string }[]
    if (!Array.isArray(notes) || !notes.every((n) => OLD_DEMO_IDS.has(n.id))) return
    for (const k of ['notes', 'connections', 'canvas-transform']) removeItem(P + k)
    if (!getItem(P + 'ink') || getItem(P + 'ink') === '[]') removeItem(P + 'ink')
    if (!getItem(P + 'frames') || getItem(P + 'frames') === '[]') removeItem(P + 'frames')
  } catch {
    /* storage unavailable */
  }
}
migrateOldDemo()

function initialVaults(): Vault[] {
  // migrate the old single-vault name (settings.vaultName)
  let name = 'Aether'
  try {
    const raw = getItem('aethel-vault:settings')
    const old = raw ? (JSON.parse(raw) as Partial<AppSettings>).vaultName : undefined
    if (old && old !== 'Aethel Vault') name = old
  } catch {
    /* ignore */
  }
  return [{ id: DEFAULT_VAULT_ID, name, createdAt: Date.now() }]
}

export default function App() {
  const [storedSettings, setSettings] = usePersistentState<AppSettings>('settings', DEFAULT_SETTINGS)
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...storedSettings }), [storedSettings])
  // set before children render so every t() call sees the current language
  setLang(settings.language)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsJump, setSettingsJump] = useState<{ section: 'general'; n: number }>()
  /** First launch: nothing else (not even the guide vault) is created until a language is picked. */
  const [langChosen, setLangChosen] = usePersistentState<boolean>('lang-chosen', false)
  const [vaults, setVaults] = usePersistentState<Vault[]>('vaults', initialVaults())
  const [activeVaultId, setActiveVaultId] = usePersistentState<string>('active-vault', DEFAULT_VAULT_ID)
  const vault = vaults.find((v) => v.id === activeVaultId) ?? vaults[0]
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('view-mode', 'canvas')
  const [zoomPercent, setZoomPercent] = useState(100)
  const apiRef = useRef<WorkspaceApi | null>(null)
  // ---------- sharing ----------
  const [shareOpen, setShareOpen] = useState(false)
  const shareBtnRef = useRef<HTMLButtonElement>(null)
  const [copyNonce, setCopyNonce] = useState(0)
  const [incoming, setIncoming] = useState<ShareToken | null>(null)
  /** A pasted / opened text: if it is an Aether board link, show the "open as a new workspace" dialog. */
  const handleShareLink = useCallback((text: string) => {
    const link = parseShareLink(text)
    if (!link) return false
    setShareOpen(false)
    setIncoming(link)
    return true
  }, [])
  const [splash, setSplash] = useState(shouldShowSplash)
  const hideSplash = useCallback(() => setSplash(false), [])

  // slide between vaults: direction follows the tab order
  const [leaving, setLeaving] = useState<{ id: string; dir: 1 | -1 } | null>(null)
  const [enterDir, setEnterDir] = useState<0 | 1 | -1>(0)
  const slideTimer = useRef<number | undefined>(undefined)
  const SLIDE_MS = 280
  const slideTo = useCallback(
    (fromId: string, toId: string, toIndex: number, list: Vault[]) => {
      if (fromId === toId) return
      const fromIndex = list.findIndex((v) => v.id === fromId)
      const dir: 1 | -1 = toIndex >= fromIndex ? 1 : -1
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.clearTimeout(slideTimer.current)
      if (!reduce && fromIndex >= 0) {
        setLeaving({ id: fromId, dir })
        setEnterDir(dir)
        slideTimer.current = window.setTimeout(() => {
          setLeaving(null)
          setEnterDir(0)
        }, SLIDE_MS + 40)
      }
      setActiveVaultId(toId)
    },
    [setActiveVaultId],
  )
  const switchVault = useCallback(
    (id: string) => slideTo(vault.id, id, vaults.findIndex((v) => v.id === id), vaults),
    [slideTo, vault.id, vaults],
  )

  const switchTabBy = useCallback(
    (dir: 1 | -1) => {
      if (vaults.length < 2) return
      const i = vaults.findIndex((v) => v.id === vault.id)
      const j = (i + dir + vaults.length) % vaults.length
      // keep the slide direction matching the key even when wrapping around
      window.clearTimeout(slideTimer.current)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reduce) {
        setLeaving({ id: vault.id, dir })
        setEnterDir(dir)
        slideTimer.current = window.setTimeout(() => {
          setLeaving(null)
          setEnterDir(0)
        }, SLIDE_MS + 40)
      }
      setActiveVaultId(vaults[j].id)
    },
    [vaults, vault.id, setActiveVaultId],
  )

  // ⌘⌥→ / ⌘⌥← and ⌃Tab / ⌃⇧Tab: tab to the right / left
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        if (!e.repeat) switchTabBy(e.key === 'ArrowRight' ? 1 : -1)
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        switchTabBy(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [switchTabBy])

  /** A workspace can have its own theme (and canvas background with it); otherwise the ones from Settings. */
  const withVaultTheme = useCallback(
    (v: Vault) => (v.theme ? { ...settings, theme: v.theme, canvasBg: v.canvasBg ?? settings.canvasBg } : settings),
    [settings],
  )
  const effective = useMemo(() => withVaultTheme(vault), [withVaultTheme, vault])
  useEffect(() => applySettings(effective), [effective])
  // tidy up photos of deleted notes, once, a little after launch
  useEffect(() => {
    const t = window.setTimeout(() => void collectUnusedImages().catch(() => {}), 10000)
    return () => window.clearTimeout(t)
  }, [])
  const setVaultTheme = useCallback(
    (theme: ThemeId | undefined) =>
      setVaults((prev) =>
        prev.map((v) =>
          v.id !== vault.id
            ? v
            : theme
              ? // binding: the workspace keeps the background it had (or takes the current one)
                { ...v, theme, canvasBg: v.canvasBg ?? settings.canvasBg }
              : { ...v, theme: undefined, canvasBg: undefined },
        ),
      ),
    [setVaults, vault.id, settings.canvasBg],
  )
  const setVaultCanvasBg = useCallback(
    (canvasBg: CanvasBg) => setVaults((prev) => prev.map((v) => (v.id === vault.id ? { ...v, canvasBg } : v))),
    [setVaults, vault.id],
  )
  const patchSettings = useCallback(
    (patch: Partial<AppSettings>) => setSettings((s) => ({ ...DEFAULT_SETTINGS, ...s, ...patch })),
    [setSettings],
  )

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === 'Comma') {
        e.preventDefault()
        coachKey('settings')
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const createVault = useCallback(() => {
    const id = `v${Date.now().toString(36)}`
    setVaults((prev) => {
      let n = prev.length + 1
      const names = new Set(prev.map((v) => v.name))
      while (names.has(t('Сховище {n}', { n }))) n++
      return [...prev, { id, name: t('Сховище {n}', { n }), createdAt: Date.now() }]
    })
    slideTo(vault.id, id, vaults.length, vaults)
  }, [setVaults, slideTo, vault.id, vaults])

  /** Settings → Guide: a new vault tab that starts with the feature guide. */
  const openGuide = useCallback(() => {
    const id = `v${Date.now().toString(36)}`
    setVaults((prev) => [...prev, { id, name: t('Посібник'), createdAt: Date.now(), seed: 'guide' }])
    slideTo(vault.id, id, vaults.length, vaults)
    setSettingsOpen(false)
  }, [setVaults, slideTo, vault.id, vaults])

  /** A shared board → a new workspace tab with its content, centred in view. */
  const openSharedBoard = useCallback(
    (b: SharedBoard) => {
      const id = `v${Date.now().toString(36)}`
      const content = { notes: b.notes, connections: b.connections, frames: b.frames, chips: b.chips, ink: b.strokes }
      const backend = getVaultBackend()
      for (const k of ['notes', 'connections', 'frames', 'chips', 'ink'] as const) backend.save(id, k, content[k] as never, content)
      // frame the content (free drawings included) so it is in view right away
      const xs: number[] = []
      const ys: number[] = []
      for (const o of [...b.notes, ...b.frames]) xs.push(o.x, o.x + o.width), ys.push(o.y, o.y + (o.height || 160))
      for (const st of b.strokes)
        if (!st.note) for (let i = 0; i < st.points.length; i += 2) xs.push(st.x + st.points[i]), ys.push(st.y + st.points[i + 1])
      if (xs.length) {
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const view = fitTransform({ x: x - 40, y: y - 40, width: Math.max(...xs) - x + 80, height: Math.max(...ys) - y + 80 })
        backend.save(id, 'canvas-transform', view, content)
      }
      setVaults((prev) => {
        const names = new Set(prev.map((v) => v.name))
        const base = (b.name.trim() || t('Спільна дошка')).replace(/ \(\d+\)$/, '')
        let name = base
        for (let n = 2; names.has(name); n++) name = `${base} (${n})`
        return [...prev, { id, name, createdAt: Date.now(), ...(b.theme ? { theme: b.theme.theme, canvasBg: b.theme.canvasBg } : {}) }]
      })
      slideTo(vault.id, id, vaults.length, vaults)
      setIncoming(null)
    },
    [setVaults, slideTo, vault.id, vaults],
  )

  // links opened from outside: aether://open#… (the desktop app's link scheme)
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let off: (() => void) | undefined
    let dead = false
    void import('@tauri-apps/plugin-deep-link')
      .then(async ({ getCurrent, onOpenUrl }) => {
        const first = await getCurrent().catch(() => null)
        if (first?.length) first.some((u) => handleShareLink(u))
        const un = await onOpenUrl((urls) => urls.some((u) => handleShareLink(u)))
        if (dead) un()
        else off = un
      })
      .catch(() => {})
    return () => {
      dead = true
      off?.()
    }
  }, [handleShareLink])

  // Ctrl/⌘ + Shift + C: copy a link to the board (or the selection) with the current share options
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== 'KeyC') return
      coachKey('share')
      const el = e.target as HTMLElement | null
      if (el?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      e.stopPropagation()
      setShareOpen(true)
      setCopyNonce((n) => n + 1)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])

  const renameVault = useCallback(
    (id: string, name: string) => setVaults((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v))),
    [setVaults],
  )

  /**
   * Deleting a workspace can be undone for a few seconds: the tab goes away at once, its files only when the
   * "Deleted · Undo" toast expires (or the app closes).
   */
  const deleteVault = useCallback(
    (id: string) => {
      if (vaults.length <= 1) return
      const at = vaults.findIndex((v) => v.id === id)
      const gone = vaults[at]
      if (!gone) return
      const wasActive = id === activeVaultId
      const rest = vaults.filter((v) => v.id !== id)
      setVaults(rest)
      if (wasActive) setActiveVaultId(rest[Math.max(0, at - 1)].id)
      showToast({
        id: 'vault-deleted',
        text: t('Сховище «{name}» видалено', { name: gone.name }),
        ms: 8000,
        expireOnExit: true,
        action: {
          label: t('Повернути'),
          run: () => {
            setVaults((prev) => (prev.some((v) => v.id === gone.id) ? prev : [...prev.slice(0, at), gone, ...prev.slice(at)]))
            if (wasActive) setActiveVaultId(gone.id)
          },
        },
        onExpire: () => deleteVaultData(gone.id),
      })
    },
    [vaults, activeVaultId, setVaults, setActiveVaultId],
  )

  // after an import (the app has just reloaded): say so, with the way back
  useEffect(() => {
    const raw = getItem('aethel-vault:' + IMPORT_DONE)
    if (!raw) return
    removeItem('aethel-vault:' + IMPORT_DONE)
    let info: { at?: number; revert?: boolean } = {}
    try {
      info = JSON.parse(raw)
    } catch {
      /* ignore */
    }
    if (!info.at || Date.now() - info.at > 120000) return
    window.setTimeout(
      () =>
        showToast(
          info.revert
            ? { id: 'import', text: t('Дані повернуто, як було до імпорту'), ms: 6000 }
            : {
                id: 'import',
                text: t('Дані імпортовано'),
                ms: 12000,
                ...(hasPreImport() ? { action: { label: t('Повернути як було'), run: () => void revertImport() } } : {}),
              },
        ),
      600,
    )
  }, [])

  const leavingVault = leaving ? vaults.find((v) => v.id === leaving.id) : undefined
  const panes = leavingVault ? [leavingVault, vault] : [vault]
  const dirName = (d: number) => (d > 0 ? 'next' : 'prev')

  if (!langChosen)
    return (
      <LangContext.Provider value={settings.language}>
        {/* the first launch has its own intro inside the picker, so the regular splash is skipped */}
        <LanguagePicker
          onPick={(language) => {
            hideSplash()
            patchSettings({ language })
            setLangChosen(true)
          }}
        />
      </LangContext.Provider>
    )

  return (
    <LangContext.Provider value={settings.language}>
      <div className={`app-root view-${viewMode}`}>
        {/* WCAG 2.4.1: first Tab stop jumps over the top bar straight to the notes */}
        <a
          className="skip-link"
          href="#canvas-main"
          onClick={(e) => {
            e.preventDefault()
            const first = document.querySelector<HTMLElement>('.ws-pane:not(.is-leaving) [data-note-id]')
            ;(first ?? document.getElementById('canvas-main'))?.focus()
          }}
        >
          {t('Перейти до нотаток')}
        </a>
        <TopBar
          vaults={vaults}
          activeVaultId={vault.id}
          onSwitchVault={switchVault}
          onCreateVault={createVault}
          onRenameVault={renameVault}
          onDeleteVault={deleteVault}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onNewNote={() => apiRef.current?.newNote()}
          onOpenSettings={() => {
            coachMouse('settings')
            setSettingsOpen(true)
          }}
          onShare={() => {
            if (!shareOpen) coachMouse('share')
            setShareOpen((v) => !v)
          }}
          shareOpen={shareOpen}
          shareRef={shareBtnRef}
          zoomPercent={zoomPercent}
          showZoom={settings.showZoom}
        />
        <main className="ws-stage" id="canvas-main" tabIndex={-1} aria-label={t('Полотно')}>
          <h1 className="sr-only">{vault.name} — Aether</h1>
          {panes.map((v) => {
            const isActive = v.id === vault.id
            const cls = isActive
              ? enterDir
                ? ` is-entering from-${dirName(enterDir)}`
                : ''
              : ` is-leaving to-${dirName(leaving!.dir)}`
            return (
              <div key={v.id} className={`ws-pane${cls}`} inert={!isActive}>
                <Workspace
                  vault={v}
                  active={isActive}
                  apiRef={isActive ? apiRef : undefined}
                  settings={withVaultTheme(v)}
                  onSetTheme={(theme) => (v.theme ? setVaultTheme(theme) : patchSettings({ theme }))}
                  patchSettings={patchSettings}
                  settingsOpen={settingsOpen}
                  onOpenSettings={() => setSettingsOpen(true)}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  onZoomChange={isActive ? setZoomPercent : undefined}
                  onSwitchTab={switchTabBy}
                  tabCount={vaults.length}
                  onShareLink={isActive ? handleShareLink : undefined}
                  onOpenShare={() => setShareOpen(true)}
                />
              </div>
            )
          })}
        </main>
      </div>
      <SettingsModal
        jump={settingsJump}
        open={settingsOpen}
        settings={settings}
        vaultName={vault.name}
        onRenameVault={(name) => renameVault(vault.id, name)}
        onChange={patchSettings}
        onClose={() => setSettingsOpen(false)}
        onOpenGuide={openGuide}
        vaultTheme={vault.theme}
        onVaultTheme={setVaultTheme}
        vaultCanvasBg={vault.canvasBg}
        onVaultCanvasBg={setVaultCanvasBg}
      />
      <ShareMenu
        open={shareOpen}
        anchor={shareBtnRef.current}
        onClose={() => setShareOpen(false)}
        api={apiRef}
        copyNonce={copyNonce}
        vaultId={vault.id}
        vaultName={vault.name}
        theme={effective.theme}
        canvasBg={effective.canvasBg}
      />
      {!splash && !incoming && viewMode === 'canvas' && <FirstHints />}
      {incoming && !splash && <ShareOpenDialog link={incoming} onOpen={openSharedBoard} onCancel={() => setIncoming(null)} />}
      {splash && <SplashScreen onDone={hideSplash} />}
      <UpdateNotice currentVersion={pkg.version} />
      <Toast />
      <UnreadableNotice />
      <SaveStatusBanner
        onOpenSettings={() => {
          setSettingsJump((j) => ({ section: 'general', n: (j?.n ?? 0) + 1 }))
          setSettingsOpen(true)
        }}
      />
      {/* WCAG 4.1.3: changes (deleted, undone, linked…) are announced here — see features/announce.ts */}
      <div id="sr-status" className="sr-only" role="status" aria-live="polite" />
    </LangContext.Provider>
  )
}
