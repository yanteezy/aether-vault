import { useState } from 'react'
import { useT } from '../i18n'
import { dataDir, defaultFolder, inspectFolder, isDesktop, moveToFolder, pickFolder, type FolderInfo } from '../features/store'
import { revealFile } from '../features/backup'
import './DataFolder.css'

/** Settings → General → Data folder: where notes, settings and photos are kept (desktop app). */
export function DataFolderPanel() {
  const tr = useT()
  const [{ dir, custom }] = useState(dataDir)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** a folder that already holds Aether data: open it, or cancel */
  const [found, setFound] = useState<(FolderInfo & { path: string }) | null>(null)
  if (!isDesktop()) return null

  const go = async (path: string | null) => {
    if (!path) return
    setError('')
    setBusy(true)
    try {
      const info = await inspectFolder(path)
      if (info.target === dir) return
      if (info.hasData) return setFound({ ...info, path })
      await moveToFolder(path, false) // copies the data there, then reloads
    } catch (e) {
      setError(tr('Не вдалося змінити папку') + ': ' + String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings__group data-folder">
      <div className="settings__row settings__row--stack">
        <div className="settings__label">
          {tr('Папка даних')}
          <span className="settings__hint">
            {tr('Тут лежать нотатки, налаштування й фото. Можна вибрати свою папку — наприклад, у Dropbox, OneDrive чи iCloud, щоб нотатки були на всіх компʼютерах.')}
          </span>
        </div>
        <code className="data-folder__path" title={dir}>
          {dir}
        </code>
        {!found ? (
          <div className="backup__actions">
            <button className="backup__btn" disabled={busy} onClick={() => void pickFolder().then(go)}>
              {tr('Змінити…')}
            </button>
            <button className="backup__btn" disabled={busy} onClick={() => void revealFile(dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + 'aether-data.json')}>
              {tr('Відкрити папку')}
            </button>
            {custom && (
              <button className="backup__btn" disabled={busy} onClick={() => void defaultFolder().then(go)}>
                {tr('Стандартна папка')}
              </button>
            )}
          </div>
        ) : (
          <div className="backup__confirm">
            <div className="backup__file">
              <strong>{tr('У цій папці вже є дані Aether')}</strong>
              <span>
                {found.target} · {tr('нотаток: {n}', { n: found.notes })}
              </span>
            </div>
            <p className="backup__warn">{tr('Aether відкриє нотатки з цієї папки. Поточні залишаться в старій папці — до них можна повернутися тут же.')}</p>
            <div className="backup__actions">
              <button
                className="backup__btn backup__btn--primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  moveToFolder(found.path, true).catch((e) => {
                    setBusy(false)
                    setError(tr('Не вдалося змінити папку') + ': ' + String((e as Error)?.message ?? e))
                  })
                }}
              >
                {tr('Відкрити ці дані')}
              </button>
              <button className="backup__btn" disabled={busy} onClick={() => setFound(null)}>
                {tr('Скасувати')}
              </button>
            </div>
          </div>
        )}
        {!found && <span className="settings__hint">{tr('Під час зміни дані копіюються в нову папку, стара залишається як резервна копія.')}</span>}
        {error && (
          <p className="backup__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
