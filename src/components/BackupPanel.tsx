import { useRef, useState } from 'react'
import { useT } from '../i18n'
import {
  applyBackup,
  BACKUP_EXT,
  BACKUP_SECTIONS,
  backupFileName,
  createBackup,
  parseBackup,
  revealFile,
  saveBackupFile,
  summarize,
  type Backup,
  type BackupSection,
} from '../features/backup'
import './BackupPanel.css'

/** Settings → General: export the chosen data to an .aether file, and import one back. */

const LABELS: Record<BackupSection, [string, string]> = {
  notes: ['Нотатки', 'Усі сховища: нотатки, звʼязки, рамки, кнопки, малюнки, фото'],
  themes: ['Теми', 'Тема, акцент, скло, фон полотна, власні теми сховищ'],
  settings: ['Налаштування', 'Мова, сітка, шрифти, гарячі клавіші та інше'],
}
const ERRORS: Record<string, string> = {
  'not-json': 'Це не файл резервної копії Aether',
  'not-aether': 'Це не файл резервної копії Aether',
  'too-new': 'Файл створено новішою версією Aether — спершу оновіть застосунок',
}

function Checks({ value, onChange, only }: { value: BackupSection[]; onChange: (v: BackupSection[]) => void; only?: BackupSection[] }) {
  const tr = useT()
  return (
    <div className="backup__checks">
      {BACKUP_SECTIONS.filter((s) => !only || only.includes(s)).map((s) => {
        const on = value.includes(s)
        return (
          <label key={s} className={`backup__check${on ? ' is-on' : ''}`}>
            <input
              type="checkbox"
              checked={on}
              onChange={() => onChange(on ? value.filter((x) => x !== s) : BACKUP_SECTIONS.filter((x) => x === s || value.includes(x)))}
            />
            <span className="backup__box" aria-hidden="true">
              <svg viewBox="0 0 12 12" width="10" height="10">
                <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="backup__check-text">
              <span className="backup__check-name">{tr(LABELS[s][0])}</span>
              <span className="backup__check-hint">{tr(LABELS[s][1])}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

export function BackupPanel() {
  const tr = useT()
  const [exportSel, setExportSel] = useState<BackupSection[]>([...BACKUP_SECTIONS])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<{ path: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ backup: Backup; name: string } | null>(null)
  const [importSel, setImportSel] = useState<BackupSection[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const doExport = async () => {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const b = await createBackup(exportSel)
      const path = await saveBackupFile(backupFileName(), JSON.stringify(b))
      setSaved({ path })
    } catch (e) {
      setError(tr('Не вдалося зберегти файл') + (e instanceof Error && e.message ? `: ${e.message}` : ''))
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setSaved(null)
    try {
      const backup = parseBackup(await file.text())
      setPending({ backup, name: file.name })
      setImportSel(backup.sections)
    } catch (e) {
      setError(tr(ERRORS[(e as Error).message] ?? 'Не вдалося прочитати файл'))
    }
  }

  const doImport = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await applyBackup(pending.backup, importSel) // reloads the app
    } catch {
      setBusy(false)
      setError(tr('Не вдалося імпортувати дані'))
    }
  }

  const sum = pending ? summarize(pending.backup) : null
  return (
    <div className="settings__group backup">
      <div className="settings__row settings__row--stack">
        <div className="settings__label">
          {tr('Експорт даних')}
          <span className="settings__hint">{tr('Файл .{ext}, який можна відкрити в Aether на іншому компʼютері', { ext: BACKUP_EXT })}</span>
        </div>
        <Checks value={exportSel} onChange={setExportSel} />
        <div className="backup__actions">
          <button className="backup__btn backup__btn--primary" disabled={busy || !exportSel.length} onClick={doExport}>
            {tr('Експортувати')}
          </button>
          {saved && (
            <span className="backup__status" role="status">
              {saved.path ? tr('Збережено в «Завантаження»') : tr('Файл завантажено')}
              {saved.path && (
                <button className="backup__link" onClick={() => void revealFile(saved.path!)}>
                  {tr('Показати в папці')}
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="settings__row settings__row--stack">
        <div className="settings__label">
          {tr('Імпорт даних')}
          <span className="settings__hint">{tr('Перенести дані з файлу резервної копії')}</span>
        </div>
        {!pending ? (
          <div className="backup__actions">
            <button className="backup__btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {tr('Імпортувати…')}
            </button>
          </div>
        ) : (
          <div className="backup__confirm">
            <div className="backup__file">
              <strong>{pending.name}</strong>
              <span>
                {[
                  sum && sum.vaults ? tr('сховищ: {n}', { n: sum.vaults }) : '',
                  sum && sum.vaults ? tr('нотаток: {n}', { n: sum.notes }) : '',
                  sum && sum.images ? tr('фото: {n}', { n: sum.images }) : '',
                  sum ? new Date(sum.createdAt).toLocaleDateString() : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <Checks value={importSel} onChange={setImportSel} only={pending.backup.sections} />
            {importSel.includes('notes') && (
              <p className="backup__warn">{tr('Сховища з файлу замінять однойменні сховища тут (перше сховище — завжди «Aether»). Інші сховища залишаться.')}</p>
            )}
            <div className="backup__actions">
              <button className="backup__btn backup__btn--primary" disabled={busy || !importSel.length} onClick={doImport}>
                {tr('Імпортувати')}
              </button>
              <button className="backup__btn" disabled={busy} onClick={() => setPending(null)}>
                {tr('Скасувати')}
              </button>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={`.${BACKUP_EXT},application/json`}
          hidden
          onChange={(e) => {
            void pickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {error && (
        <p className="backup__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
