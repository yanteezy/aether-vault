/**
 * Updates from GitHub Releases (yanteezy/aether-vault), like the old Aether: the app checks shortly after start
 * and every 6 hours, tells the page what it found, and downloads / installs only when the user says so.
 *  - Windows: electron-updater reads `latest.yml` of the latest release, downloads the installer, checks its sha512.
 *  - macOS: an unsigned app cannot update itself (Squirrel.Mac needs a signature), so «Оновити» opens the release page.
 * Bundled with esbuild into dist/main/updater.cjs (the packaged app has no node_modules).
 */
import { app, ipcMain, shell, type WebContents } from 'electron'
import electronUpdater from 'electron-updater'

export type UpdateState =
  | { state: 'idle' | 'checking' | 'none' | 'dev' }
  | { state: 'available'; version: string; notes?: string; manual: boolean }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export const RELEASES = 'https://github.com/yanteezy/aether-vault/releases/latest'
const SIX_HOURS = 6 * 60 * 60 * 1000

export function setupUpdater(page: () => WebContents | undefined) {
  const { autoUpdater } = electronUpdater
  let current: UpdateState = { state: app.isPackaged ? 'idle' : 'dev' }
  const manual = process.platform === 'darwin'
  const tell = (s: UpdateState) => { current = s; page()?.send('update:state', s) }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true // once downloaded, a normal quit installs it too
  autoUpdater.on('checking-for-update', () => tell({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => tell({ state: 'none' }))
  autoUpdater.on('update-available', (i) => tell({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : undefined, manual }))
  autoUpdater.on('download-progress', (p) => { if (current.state === 'downloading') tell({ ...current, percent: Math.round(p.percent) }) })
  autoUpdater.on('update-downloaded', (i) => tell({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => tell({ state: 'error', message: e?.message ?? String(e) }))

  const check = async () => {
    if (!app.isPackaged) return tell({ state: 'dev' }) // a dev build has no release to compare with
    try { await autoUpdater.checkForUpdates() } catch (e) { tell({ state: 'error', message: e instanceof Error ? e.message : String(e) }) }
  }

  ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, platform: process.platform }))
  ipcMain.handle('update:state', () => current)
  ipcMain.handle('update:check', async () => { await check(); return current })
  ipcMain.handle('update:download', async () => {
    if (current.state !== 'available') return
    if (current.manual) { await shell.openExternal(RELEASES); return }
    tell({ state: 'downloading', version: current.version, percent: 0 })
    try { await autoUpdater.downloadUpdate() } catch (e) { tell({ state: 'error', message: e instanceof Error ? e.message : String(e) }) }
  })
  // the page has saved everything before it asks
  ipcMain.handle('update:install', () => { if (current.state === 'ready') autoUpdater.quitAndInstall(false, true) })
  ipcMain.handle('update:releases', () => shell.openExternal(RELEASES))

  if (app.isPackaged) {
    setTimeout(() => void check(), 8000)
    setInterval(() => void check(), SIX_HOURS)
  }
}
