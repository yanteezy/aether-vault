import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/themes.css'
import './styles/theme-light.css'
import './styles/canvas-bg.css'
import './styles/selection.css'
import './styles/redesign.css'
import { flush, initStore, isDesktop } from './features/store'

const root = createRoot(document.getElementById('root')!)

async function boot() {
  // the data folder is read before anything else, so every part of the app starts from the saved state
  let moveFailed = ''
  try {
    await initStore()
    if (isDesktop()) {
      const { startFiles } = await import('./features/fileStoreBoot')
      const files = await startFiles()
      if (files.mode === 'failed') moveFailed = files.reason
    }
  } catch (e) {
    const { DataFolderError } = await import('./components/DataFolderError')
    root.render(<DataFolderError error={String((e as Error)?.message ?? e)} />)
    return
  }
  if (isDesktop()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    let warned = false
    // closing the window: wait until the last changes are on disk (a few seconds at most)
    void getCurrentWindow().onCloseRequested(async (ev) => {
      const ok = await Promise.race([flush(), new Promise<boolean>((r) => window.setTimeout(() => r(false), 4000))])
      if (!ok && !warned) {
        warned = true
        ev.preventDefault()
        window.dispatchEvent(new Event('aether:close-blocked'))
      }
    })
  }
  const { default: App } = await import('./App.tsx')
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  if (moveFailed) {
    console.error('moving to files failed:', moveFailed)
    const [{ showToast }, { t }] = await Promise.all([import('./features/toast'), import('./i18n')])
    // after the first render, which sets the language
    window.setTimeout(() => showToast({ id: 'files', text: t('Не вдалося перенести нотатки у файли — Aether працює як раніше, нічого не змінено'), ms: 0 }), 1500)
  }
}
void boot()
