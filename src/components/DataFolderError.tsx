import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { inspectFolder, pickFolder } from '../features/store'
import { setLang, systemLang, t } from '../i18n'
import './DataFolder.css'

/**
 * Shown instead of the app when the picked data folder cannot be opened (an unplugged drive, a cloud folder that
 * is not synced yet…). Aether never starts empty over it: the user retries, points to the folder, or goes back to
 * the default one.
 */
export function DataFolderError({ error }: { error: string }) {
  setLang(systemLang())
  const missing = error.startsWith('missing-dir:') ? error.slice('missing-dir:'.length) : ''
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const choose = async () => {
    setBusy(true)
    setMsg('')
    try {
      const path = await pickFolder()
      if (!path) return
      const info = await inspectFolder(path)
      await invoke('data_set_dir', { path, adopt: info.hasData })
      window.location.reload()
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const useDefault = async () => {
    setBusy(true)
    try {
      await invoke('data_use_default')
      window.location.reload()
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e))
      setBusy(false)
    }
  }

  return (
    <div className="data-missing" role="alertdialog" aria-labelledby="data-missing-title" aria-describedby="data-missing-text">
      <div className="data-missing__card">
        <h1 id="data-missing-title">{t('Папка з даними недоступна')}</h1>
        <p id="data-missing-text">
          {missing
            ? t('Aether не бачить папку, у якій лежать ваші нотатки. Можливо, диск відключено або хмарна папка ще не синхронізувалась.')
            : t('Не вдалося прочитати дані.')}
        </p>
        {missing && <code className="data-missing__path">{missing}</code>}
        {!missing && <code className="data-missing__path">{error}</code>}
        <div className="data-missing__actions">
          <button className="data-missing__btn is-primary" disabled={busy} onClick={() => window.location.reload()} autoFocus>
            {t('Спробувати ще')}
          </button>
          <button className="data-missing__btn" disabled={busy} onClick={() => void choose()}>
            {t('Вказати папку…')}
          </button>
          <button className="data-missing__btn" disabled={busy} onClick={() => void useDefault()}>
            {t('Стандартна папка')}
          </button>
        </div>
        <p className="data-missing__note">{t('Нічого не видаляється: дані в недоступній папці залишаться як були.')}</p>
        {msg && (
          <p className="data-missing__err" role="alert">
            {msg}
          </p>
        )}
      </div>
    </div>
  )
}
