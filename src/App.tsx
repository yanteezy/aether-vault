import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Workspace, type WorkspaceApi } from './Workspace'
import { TopBar, type ViewMode } from './components/TopBar'
import { SettingsModal } from './components/SettingsModal'
import { SplashScreen, shouldShowSplash } from './components/SplashScreen'
import { UpdateNotice } from './components/UpdateNotice'
import { LanguagePicker } from './components/LanguagePicker'
import pkg from '../package.json'
import { applySettings, DEFAULT_SETTINGS, type AppSettings, type ThemeId } from './settings/settings'
import { usePersistentState } from './hooks/usePersistentState'
import { DEFAULT_VAULT_ID, deleteVaultData } from './hooks/vaultKeys'
import type { Vault } from './types/note'
import { LangContext, setLang, t } from './i18n'
import { OLD_DEMO_IDS } from './data/guide'
import { collectUnusedImages } from './features/images'
import './App.css'

/**
 * One-time upgrade: the old sample notes (Project Cosmos…) are replaced by the feature guide
 * when the first vault still holds only those samples.
 */
function migrateOldDemo() {
  const P = 'aethel-vault:'
  try {
    if (localStorage.getItem(P + 'guide-migrated')) return
    localStorage.setItem(P + 'guide-migrated', '1')
    const raw = localStorage.getItem(P + 'notes')
    if (!raw) return
    const notes = JSON.parse(raw) as { id: string }[]
    if (!Array.isArray(notes) || !notes.every((n) => OLD_DEMO_IDS.has(n.id))) return
    for (const k of ['notes', 'connections', 'canvas-transform']) localStorage.removeItem(P + k)
    if (!localStorage.getItem(P + 'ink') || localStorage.getItem(P + 'ink') === '[]') localStorage.removeItem(P + 'ink')
    if (!localStorage.getItem(P + 'frames') || localStorage.getItem(P + 'frames') === '[]') localStorage.removeItem(P + 'frames')
  } catch {
    /* storage unavailable */
  }
}
migrateOldDemo()

function initialVaults(): Vault[] {
  // migrate the old single-vault name (settings.vaultName)
  let name = 'Aether'
  try {
    const raw = localStorage.getItem('aethel-vault:settings')
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
  /** First launch: nothing else (not even the guide vault) is created until a language is picked. */
  const [langChosen, setLangChosen] = usePersistentState<boolean>('lang-chosen', false)
  const [vaults, setVaults] = usePersistentState<Vault[]>('vaults', initialVaults())
  const [activeVaultId, setActiveVaultId] = usePersistentState<string>('active-vault', DEFAULT_VAULT_ID)
  const vault = vaults.find((v) => v.id === activeVaultId) ?? vaults[0]
  const [viewMode, setViewMode] = usePersistentState<ViewMode>('view-mode', 'canvas')
  const [zoomPercent, setZoomPercent] = useState(100)
  const apiRef = useRef<WorkspaceApi | null>(null)
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

  /** A workspace can have its own theme; otherwise the one from Settings. */
  const withVaultTheme = useCallback(
    (v: Vault) => (v.theme ? { ...settings, theme: v.theme } : settings),
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
    (theme: ThemeId | undefined) => setVaults((prev) => prev.map((v) => (v.id === vault.id ? { ...v, theme } : v))),
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

  const renameVault = useCallback(
    (id: string, name: string) => setVaults((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v))),
    [setVaults],
  )

  const deleteVault = useCallback(
    (id: string) => {
      if (vaults.length <= 1) return
      deleteVaultData(id)
      const rest = vaults.filter((v) => v.id !== id)
      setVaults(rest)
      if (id === activeVaultId) setActiveVaultId(rest[0].id)
    },
    [vaults, activeVaultId, setVaults, setActiveVaultId],
  )

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
          onOpenSettings={() => setSettingsOpen(true)}
          zoomPercent={zoomPercent}
          showZoom={settings.showZoom}
        />
        <div className="ws-stage">
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
                />
              </div>
            )
          })}
        </div>
      </div>
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        vaultName={vault.name}
        onRenameVault={(name) => renameVault(vault.id, name)}
        onChange={patchSettings}
        onClose={() => setSettingsOpen(false)}
        onOpenGuide={openGuide}
        vaultTheme={vault.theme}
        onVaultTheme={setVaultTheme}
      />
      {splash && <SplashScreen onDone={hideSplash} />}
      <UpdateNotice currentVersion={pkg.version} />
    </LangContext.Provider>
  )
}
