import { app, BrowserWindow, dialog, ipcMain, net, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { basename, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKUP_EXT, importBackup, readBackup, writeBackup, type BackupMode } from './backup.js'
import { legacyDir, moveLegacy, readLegacy } from './legacy.js'
import { createRequire } from 'node:module'

// Opening a vault is thousands of small reads and stats; libuv's default 4 threads make them queue (pages inherit it)
process.env.UV_THREADPOOL_SIZE ??= '64'

/** `--vault=<folder>` opens that folder at start (used by the smoke test); a folder picked later replaces it. */
let vaultArg = process.argv.find((a) => a.startsWith('--vault='))?.slice('--vault='.length) ?? null

ipcMain.handle('vault:initial', () => vaultArg)

// Claude: the read-only MCP server and its one-click extension; in the installer they are unpacked from app.asar,
// because Claude runs the server with its own Node and Claude Desktop opens the .mcpb by path
const unpacked = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url)).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
// «Галактика»: the vault's graph and 3D layout, built in a worker thread so the window never stalls
ipcMain.handle('galaxy:load', (_e, vault: string) => new Promise((resolve, reject) => {
  const worker = new Worker(unpacked('dist/main/galaxyWorker.cjs'), { workerData: { vault } })
  worker.once('message', (m: { ok: boolean; data?: unknown; error?: string }) => { void worker.terminate(); m.ok ? resolve(m.data) : reject(new Error(m.error)) })
  worker.once('error', reject)
}))
ipcMain.handle('claude:info', () => {
  const mcpb = unpacked('dist/claude/aether.mcpb')
  return { mcpb: existsSync(mcpb) ? mcpb : null, server: unpacked('dist/mcp/server.cjs') }
})
ipcMain.handle('claude:install', async () => {
  const mcpb = unpacked('dist/claude/aether.mcpb')
  if (!existsSync(mcpb)) return 'Файл розширення не знайдено. Перевстановіть застосунок.'
  const error = await shell.openPath(mcpb) // Claude Desktop handles .mcpb and shows its install dialog
  return error ? `Не вдалося відкрити розширення: ${error}. Чи встановлено Claude Desktop?` : ''
})
ipcMain.handle('image:pick', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, { title: 'Оберіть фото', properties: ['openFile'], filters: [{ name: 'Зображення', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'] }] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('vault:pick', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, { title: 'Оберіть папку сховища', properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled) return null
  // the page reloads into the picked folder and asks `vault:initial` first: it must not get the start folder back
  vaultArg = r.filePaths[0]
  return vaultArg
})
let imported: string | null = null
// «Резервні копії»: the user picks where the .aetherbackup goes; the vault is only read
const backupFilter = [{ name: 'Резервна копія Aether', extensions: [BACKUP_EXT] }]
ipcMain.handle('backup:create', async (e, vault: string, mode: BackupMode) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const day = new Date().toLocaleDateString('sv') // YYYY-MM-DD
  const r = await dialog.showSaveDialog(win, {
    title: 'Зберегти резервну копію',
    defaultPath: join(app.getPath('documents'), `${basename(vault)} — копія ${day}${mode === 'notes' ? ' (нотатки)' : ''}.${BACKUP_EXT}`),
    filters: backupFilter,
  })
  if (r.canceled || !r.filePath) return null
  return { path: r.filePath, ...(await writeBackup(vault, mode === 'notes' ? 'notes' : 'all', r.filePath, basename(vault))) }
})
// import: a backup file, then the folder to put the new vault in (a new subfolder is made there; nothing is overwritten)
ipcMain.handle('backup:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const f = await dialog.showOpenDialog(win, { title: 'Оберіть резервну копію', properties: ['openFile'], filters: backupFilter })
  if (f.canceled || !f.filePaths[0]) return null
  await readBackup(f.filePaths[0]) // not ours or damaged: say so before asking for a folder
  const d = await dialog.showOpenDialog(win, { title: 'Де створити нове сховище', defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] })
  if (d.canceled || !d.filePaths[0]) return null
  const done = await importBackup(f.filePaths[0], d.filePaths[0])
  imported = done.path
  return done
})
// notes from the old Aether (0.2.x): found in its data folder, copied into new vault folders; the old folder is only read.
// `--legacy-appdata=<dir>` / `--legacy-target=<dir>` point tests at a copy and a temp folder, never the real ones.
const legacyTarget = () => process.argv.find((a) => a.startsWith('--legacy-target='))?.slice('--legacy-target='.length) ?? join(app.getPath('documents'), 'Aether')
const legacyAppData = () => process.argv.find((a) => a.startsWith('--legacy-appdata='))?.slice('--legacy-appdata='.length) ?? app.getPath('appData')
ipcMain.handle('legacy:find', async () => {
  const dir = await legacyDir(legacyAppData())
  if (!dir) return null
  const data = await readLegacy(dir)
  return data.vaults.length ? { vaults: data.vaults.length, notes: data.vaults.reduce((n, v) => n + v.notes, 0), target: legacyTarget() } : null
})
ipcMain.handle('legacy:move', async () => {
  const dir = await legacyDir(legacyAppData())
  if (!dir) return null
  const moved = await moveLegacy(await readLegacy(dir), legacyTarget())
  if (moved[0]) { imported = moved[0].path; vaultArg = moved[0].path } // the old active workspace opens first
  return moved
})
// switch to a folder the app itself just made (an imported vault); the page then reloads into it
ipcMain.handle('vault:use', (_e, dir: string) => { if (dir === imported) vaultArg = dir; return dir === imported }) // only that folder: plugins share this page
ipcMain.handle('backup:show', (_e, path: string) => shell.showItemInFolder(path))
// the page cannot reload itself (will-navigate below blocks every page navigation): it asks, and the main process reloads it
ipcMain.on('app:reload', (e) => e.sender.reload())

// requestUrl() for plugins: from here there is no CORS, as in Obsidian
ipcMain.handle('request-url', async (_e, req: { url: string; method: string; headers: Record<string, string>; body?: string | ArrayBuffer }) => {
  if (!/^https?:/i.test(req.url)) throw new Error(`Only http(s) URLs: ${req.url}`)
  const r = await net.fetch(req.url, { method: req.method, headers: req.headers, body: req.body })
  return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.arrayBuffer() }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#151a26',
    titleBarStyle: 'hidden',
    // the window buttons sit in the app's 56px header row, over a transparent strip
    titleBarOverlay: { color: '#00000000', symbolColor: '#f5f5f7', height: 56 },
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      // Community plugins call require('fs'), require('electron') from the page, as in Obsidian.
      // This gives every plugin full system access; that is why plugins need the user's trust first.
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  // Let the page write unsaved notes before the window goes away.
  let canClose = false
  win.on('close', (e) => {
    if (canClose) return
    e.preventDefault()
    win.webContents.send('app:before-close')
    // a crashed or hung page must not keep the window open forever
    setTimeout(() => { canClose = true; if (!win.isDestroyed()) win.close() }, 5000)
  })
  ipcMain.on('app:can-close', (e) => {
    if (e.sender !== win.webContents) return
    canClose = true
    win.close()
  })

  // `--display=2` puts the window on the second monitor (tests run there so they do not cover the user's work)
  const displayArg = Number(process.argv.find((a) => a.startsWith('--display='))?.slice('--display='.length))
  const display = displayArg ? screen.getAllDisplays()[displayArg - 1] : undefined
  if (display) {
    const { x, y, width, height } = display.workArea
    win.setBounds({ x: x + 40, y: y + 40, width: Math.min(1360, width - 80), height: Math.min(880, height - 80) })
  }

  // the page must never navigate away from the app (a link in a note, a plugin bug); web links open in the browser
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // cursor position for the page while the pointer is over the drag area (the page gets no mouse events there):
  // polled once a frame only between the page's request and its next own mouse event
  let tracking: ReturnType<typeof setInterval> | undefined
  let last = ''
  const stopTracking = () => { clearInterval(tracking); tracking = undefined; last = '' }
  ipcMain.on('cursor:track', (e, on: boolean) => {
    if (e.sender !== win.webContents) return
    stopTracking()
    if (!on) return
    tracking = setInterval(() => {
      if (win.isDestroyed() || !win.isFocused()) return stopTracking()
      const p = screen.getCursorScreenPoint()
      const b = win.getContentBounds()
      const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height
      const msg = inside ? { x: p.x - b.x, y: p.y - b.y } : null
      const key = JSON.stringify(msg)
      if (key !== last) { last = key; win.webContents.send('cursor:pos', msg) }
    }, 16)
  })
  win.on('blur', stopTracking)
  win.on('closed', stopTracking)

  win.loadFile(fileURLToPath(new URL('../../index.html', import.meta.url)))
}

// --user-data-dir=<dir> (tests, a second profile) keeps its own data and its own single-instance lock
const userDataArg = process.argv.find((x) => x.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
if (userDataArg) app.setPath('userData', userDataArg)

// One copy per profile: a second window on the same data fights over Chromium's cache ("Unable to move the cache")
// and, worse, two editors on one vault would overwrite each other's notes. A second launch shows the first window.
if (!app.requestSingleInstanceLock()) {
  app.exit(0) // at once: quit() would let Chromium start its caches first
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    createWindow()
    // updates: a separate bundle, because the installed app carries no node_modules
    const { setupUpdater } = createRequire(import.meta.url)('./updater.cjs') as typeof import('./updater.js')
    setupUpdater(() => BrowserWindow.getAllWindows()[0]?.webContents)
  })
}
app.on('window-all-closed', () => app.quit())
