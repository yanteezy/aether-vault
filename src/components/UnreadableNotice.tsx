import { useState } from 'react'
import { useT } from '../i18n'
import { dataDir } from '../features/store'
import { revealFile } from '../features/backup'
import { getVaultBackend } from '../features/vaultRepo'
import { FileStore } from '../features/fileStore'
import './DataFolder.css'

const SHOWN = 3

/** Note files that could not be read are missing from the board: say which, so they don't just vanish. */
export function UnreadableNotice() {
  const tr = useT()
  const [files] = useState(() => {
    const backend = getVaultBackend()
    return backend instanceof FileStore ? backend.problems : []
  })
  const [closed, setClosed] = useState(false)
  if (!files.length || closed) return null
  const root = dataDir().dir.replace(/[\\/]+$/, '')
  const sep = root.includes('\\') ? '\\' : '/'
  return (
    <div className="save-banner is-warning" role="alert">
      <span className="save-banner__text">
        {tr('Деякі файли не вдалося прочитати: {n}', { n: files.length })}
        <span className="save-banner__sub">
          {files.slice(0, SHOWN).join(', ')}
          {files.length > SHOWN ? ' …' : ''}
        </span>
        <span className="save-banner__sub">{tr('Aether їх не показує, але не змінює і не видаляє. Виправте файл і запустіть Aether знову.')}</span>
      </span>
      <button className="save-banner__btn" onClick={() => void revealFile(root + sep + files[0].split('/').join(sep))}>
        {tr('Показати файл')}
      </button>
      <button className="save-banner__btn" onClick={() => setClosed(true)}>
        {tr('Закрити')}
      </button>
    </div>
  )
}
