import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  ACCENT_PRESETS,
  DEFAULT_SETTINGS,
  type AnimationSpeed,
  type AppSettings,
  type GridStyle,
  type ThemeId,
  type CanvasBg,
  IS_MAC,
  keyLabel,
  radialKeyFromEvent,
  THEMES,
  CANVAS_BGS,
  themeHasCanvasBg,
} from '../settings/settings'
import pkg from '../../package.json'
import { FontSizeControl } from './FontSizePicker'
import { LANGS, useT, type Lang } from '../i18n'
import { requestUpdateCheck } from './UpdateNotice'
import { NoteFontPicker } from './FontPicker'
import { BackupPanel } from './BackupPanel'
import { DataFolderPanel } from './DataFolderPanel'
import './SettingsModal.css'

export type Section = 'general' | 'design' | 'shortcuts' | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'Загальні' },
  { id: 'design', label: 'Дизайн' },
  { id: 'shortcuts', label: 'Гарячі клавіші' },
  { id: 'about', label: 'Про застосунок' },
]

interface SettingsModalProps {
  open: boolean
  settings: AppSettings
  vaultName: string
  onRenameVault: (name: string) => void
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
  /** Opens a new vault with the feature guide. */
  onOpenGuide: () => void
  /** Own theme of the current workspace (undefined = follows Settings). */
  vaultTheme?: ThemeId
  onVaultTheme: (theme: ThemeId | undefined) => void
  /** Background of this workspace while it has its own theme. */
  vaultCanvasBg?: CanvasBg
  onVaultCanvasBg: (bg: CanvasBg) => void
  /** Open on this section (changes each time it is set, e.g. the save error bar → General). */
  jump?: { section: Section; n: number }
}

export function SettingsModal({ open, settings, vaultName, onRenameVault, onChange, onClose, onOpenGuide, vaultTheme, onVaultTheme, vaultCanvasBg, onVaultCanvasBg, jump }: SettingsModalProps) {
  const tr = useT()
  const [section, setSection] = useState<Section>('design')
  useEffect(() => {
    if (jump) setSection(jump.section)
  }, [jump])
  const [recording, setRecording] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open, '.settings__nav-item.is-active')
  useEffect(() => {
    if (!open || section !== 'shortcuts') setRecording(false)
  }, [open, section])

  // Recording the radial-menu key: the next key pressed becomes the new key.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setRecording(false)
      const k = radialKeyFromEvent(e)
      if (!k) return
      onChange({ radialKey: k })
      setRecording(false)
    }
    const swallowUp = (e: KeyboardEvent) => {
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', swallowUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', swallowUp, true)
    }
  }, [recording, onChange])

  useEffect(() => {
    if (!open || recording) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [open, onClose, recording])

  return (
    <div
      className={`settings-overlay${open ? ' is-open' : ''}`}
      // closed = invisible: keep it out of Tab order and screen readers too
      inert={!open}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} className="settings glass-panel-strong" role="dialog" aria-modal="true" aria-label={tr('Налаштування')}>
        <nav className="settings__nav">
          <div className="settings__nav-title">{tr('Налаштування')}</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings__nav-item${section === s.id ? ' is-active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {tr(s.label)}
            </button>
          ))}
        </nav>

        <div className="settings__content">
          <div className="settings__header">
            <h2>{tr(SECTIONS.find((s) => s.id === section)?.label ?? '')}</h2>
            <button className="settings__close" onClick={onClose} aria-label={tr('Закрити')}>
              ✕
            </button>
          </div>

          {section === 'general' && (
            <div className="settings__group">
              <Row label={tr('Мова')}>
                <Segmented<Lang>
                  value={settings.language}
                  options={LANGS.map((l) => [l.id, l.label])}
                  onChange={(v) => onChange({ language: v })}
                />
              </Row>
              <Row label={tr('Назва сховища')}>
                <input
                  className="settings__text"
                  value={vaultName}
                  onChange={(e) => onRenameVault(e.target.value)}
                />
              </Row>
              <Row label={tr('Показувати масштаб у верхній панелі')}>
                <Toggle value={settings.showZoom} onChange={(v) => onChange({ showZoom: v })} />
              </Row>
              <Row label={tr('Масштаб під курсором')} hint={tr('Колесо миші наближає до курсора, а не до центру дошки')}>
                <Toggle value={settings.zoomToCursor} onChange={(v) => onChange({ zoomToCursor: v })} />
              </Row>
              <Row label={tr('Посібник')} hint={tr('Нове сховище з нотатками про всі функції')}>
                <button className="settings__reset settings__reset--inline" onClick={onOpenGuide}>
                  {tr('Відкрити')}
                </button>
              </Row>
            </div>
          )}
          {section === 'general' && (
            <>
              <DataFolderPanel />
              <BackupPanel />
            </>
          )}

          {section === 'design' && (
            <>
              <div className="settings__group">
                <Row label={tr('Тема для')} hint={vaultTheme ? tr('Інші сховища — зі своїми темами') : undefined}>
                  <Segmented<'all' | 'vault'>
                    value={vaultTheme ? 'vault' : 'all'}
                    options={[
                      ['all', tr('Усіх сховищ')],
                      ['vault', tr('Лише «{name}»', { name: vaultName })],
                    ]}
                    onChange={(v) => onVaultTheme(v === 'vault' ? settings.theme : undefined)}
                  />
                </Row>
                <div className="settings__themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`settings__theme theme-preview--${t.id}${(vaultTheme ?? settings.theme) === t.id ? ' is-active' : ''}`}
                      onClick={() => (vaultTheme ? onVaultTheme(t.id) : onChange({ theme: t.id }))}
                    >
                      <span className="settings__theme-preview">
                        <span className="settings__theme-card" />
                        <span className="settings__theme-card" />
                      </span>
                      <span className="settings__theme-name">{tr(t.name)}</span>
                      <span className="settings__theme-desc">{tr(t.description)}</span>
                    </button>
                  ))}
                </div>
                {themeHasCanvasBg(vaultTheme ?? settings.theme) && (
                  <div className="settings__row settings__row--stack">
                    <div className="settings__label">
                      {tr('Фон полотна')}
                      <span className="settings__hint">
                        {vaultTheme ? tr('Лише для «{name}»', { name: vaultName }) : tr('Спокійні тони й тихі патерни — для тем «Скло» і «Світла»')}
                      </span>
                    </div>
                    <div className="settings__bgs" role="radiogroup" aria-label={tr('Фон полотна')}>
                      {CANVAS_BGS.map((b) => {
                        const current = vaultTheme ? (vaultCanvasBg ?? settings.canvasBg) : settings.canvasBg
                        return (
                        <button
                          key={b.id}
                          role="radio"
                          aria-checked={current === b.id}
                          className={`settings__bg${current === b.id ? ' is-active' : ''}`}
                          onClick={() => (vaultTheme ? onVaultCanvasBg(b.id) : onChange({ canvasBg: b.id }))}
                        >
                          <span className="settings__bg-tile canvas-bg-swatch" data-bg={b.id} />
                          <span className="settings__bg-name">{tr(b.name)}</span>
                        </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="settings__group">
                <Row label={tr('Акцентний колір')}>
                  <div className="settings__swatches">
                    {ACCENT_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        title={p.name}
                        className={`settings__swatch${settings.accent === p.value ? ' is-active' : ''}`}
                        style={{ background: p.value }}
                        onClick={() => onChange({ accent: p.value })}
                      />
                    ))}
                  </div>
                </Row>
              </div>

              <div className="settings__group">
                <Row label={tr('Розмиття скла')} hint={`${settings.glassBlur}px`}>
                  <Slider min={12} max={40} step={2} value={settings.glassBlur} onChange={(v) => onChange({ glassBlur: v })} />
                </Row>
                <Row label={tr('Непрозорість карток')} hint={`${Math.round(settings.cardOpacity * 100)}%`}>
                  <Slider min={0.5} max={1} step={0.05} value={settings.cardOpacity} onChange={(v) => onChange({ cardOpacity: v })} />
                </Row>
                <Row label={tr('Мінімальні закруглення кутів')}>
                  <Toggle value={settings.compactCorners} onChange={(v) => onChange({ compactCorners: v })} />
                </Row>
                {!settings.compactCorners && (
                  <Row label={tr('Радіус кутів карток')} hint={`${settings.cardRadius}px`}>
                    <Slider min={2} max={24} step={2} value={settings.cardRadius} onChange={(v) => onChange({ cardRadius: v })} />
                  </Row>
                )}
                <Row label={tr('Авторозмір тексту')} hint={tr('Текст змінюється лише разом із розміром нотатки')}>
                  <Toggle value={settings.autoTextSize} onChange={(v) => onChange({ autoTextSize: v })} />
                </Row>
                <div className="settings__row settings__row--stack">
                  <div className="settings__label">{tr('Шрифт нотаток')}</div>
                  <NoteFontPicker value={settings.noteFont} onChange={(v) => onChange({ noteFont: v ?? 'auto' })} />
                </div>
                <Row label={tr('Розмір тексту карток')} hint={tr('Перетягніть повзунок або введіть число')}>
                  <div className="settings__font-size">
                    <FontSizeControl
                      value={settings.cardFontSize}
                      shownPx={settings.cardFontSize}
                      onChange={(v) => typeof v === 'number' && onChange({ cardFontSize: v })}
                    />
                  </div>
                </Row>
                <Row label={tr('Товщина ліній зв’язків')} hint={`${settings.connectionWidth}px`}>
                  <Slider min={1.5} max={3.5} step={0.25} value={settings.connectionWidth} onChange={(v) => onChange({ connectionWidth: v })} />
                </Row>
              </div>

              <div className="settings__group">
                <Row label={tr('Сітка полотна')}>
                  <Segmented<GridStyle>
                    value={settings.grid}
                    options={[
                      ['dots', tr('Крапки')],
                      ['lines', tr('Лінії')],
                      ['none', tr('Немає')],
                    ]}
                    onChange={(v) => onChange({ grid: v })}
                  />
                </Row>
                <Row label={tr('Анімації')}>
                  <Segmented<AnimationSpeed>
                    value={settings.animation}
                    options={[
                      ['off', tr('Вимкнено')],
                      ['fast', tr('Швидко')],
                      ['normal', tr('Збалансовано')],
                      ['relaxed', tr('Плавно')],
                    ]}
                    onChange={(v) => onChange({ animation: v })}
                  />
                </Row>
              </div>

              <button
                className="settings__reset"
                onClick={() => {
                  const { vaultName, showZoom, theme, language, radialKey, zoomToCursor, ...design } = DEFAULT_SETTINGS
                  void vaultName
                  void showZoom
                  void zoomToCursor
                  void theme
                  void language
                  void radialKey
                  onChange(design)
                }}
              >
                {tr('Скинути дизайн до типового')}
              </button>
            </>
          )}

          {section === 'shortcuts' && (
            <>
            <div className="settings__group">
              <Row
                label={tr('Клавіша кругового меню')}
                hint={recording ? tr('Esc — скасувати') : tr('Утримати, навести, відпустити')}
              >
                <div className="settings__keybind-wrap">
                  {(settings.radialKey || 'Alt') !== 'Alt' && !recording && (
                    <button className="settings__reset settings__reset--inline" onClick={() => onChange({ radialKey: 'Alt' })}>
                      {tr('Скинути')}
                    </button>
                  )}
                  <button
                    className={`settings__keybind${recording ? ' is-recording' : ''}`}
                    onClick={() => setRecording((r) => !r)}
                    title={tr('Клацніть і натисніть нову клавішу')}
                  >
                    {recording ? tr('Натисніть клавішу…') : keyLabel(settings.radialKey || 'Alt')}
                  </button>
                </div>
              </Row>
            </div>
            <div className="settings__group">
              {[
                [tr('Пробіл'), 'Швидкий пошук'],
                [tr('утримати {key}', { key: keyLabel(settings.radialKey || 'Alt') }), 'Кругове меню дій (відпустіть над дією)'],
                [IS_MAC ? tr('⌘ / ⌃ + клік') : tr('Ctrl + клік'), 'Додати нотатку до виділення / прибрати'],
                [IS_MAC ? tr('⌘ / ⌃ + перетягування') : tr('Ctrl + перетягування'), 'Виділити нотатки рамкою'],
                [IS_MAC ? tr('⌘ / ⌃ під час перетягування') : tr('Ctrl під час перетягування'), 'Прилипання нотатки чи кнопки до сітки'],
                [IS_MAC ? '⌘A' : 'Ctrl+A', 'Виділити всі нотатки'],
                [IS_MAC ? '⌘K' : 'Ctrl+K', 'Пошук / створення в доку'],
                [IS_MAC ? '⌘⌥→ / ⌃Tab' : 'Ctrl+Tab', 'Вкладка праворуч'],
                [IS_MAC ? '⌘⌥← / ⌃⇧Tab' : 'Ctrl+Shift+Tab', 'Вкладка ліворуч'],
                [IS_MAC ? '⌘,' : 'Ctrl+,', 'Налаштування'],
                [tr('Колесо / два пальці / щипок'), 'Масштаб полотна'],
                [tr('Перетягування порожнього місця'), 'Переміщення полотна'],
                [tr('Затиснута середня кнопка миші'), 'Переміщення полотна будь-де'],
                ['P', 'Малювати (Esc — вийти)'],
                [tr('утримати {key}', { key: 'P' }), 'Малювати, поки тримаєте клавішу'],
                [IS_MAC ? '⇧⌘C' : 'Ctrl+Shift+C', 'Скопіювати посилання на дошку'],
                [IS_MAC ? '⌘V' : 'Ctrl+V', 'Вставити посилання на дошку — відкрити її'],
                [tr('⇧ + колесо'), 'Прокрутка вбік'],
                [tr('Подвійний клік'), 'Нова нотатка на полотні'],
                [IS_MAC ? '⌫' : 'Delete', 'Видалити виділені нотатки чи зв’язок'],
                ['Esc', 'Зняти виділення / скасувати'],
              ].map(([k, d]) => (
                <Row key={d} label={tr(d)}>
                  <kbd className="settings__kbd">{k}</kbd>
                </Row>
              ))}
            </div>
            </>
          )}

          {section === 'about' && (
            <div className="settings__group">
              <Row label="Aether">
                <span className="settings__muted">v{pkg.version}</span>
              </Row>
              <Row label={tr('Платформа')}>
                <span className="settings__muted">Tauri 2 · React</span>
              </Row>
              <Row label={tr('Оновлення')} hint={tr('Нові версії встановлюються онлайн')}>
                <button className="settings__reset settings__reset--inline" onClick={requestUpdateCheck}>
                  {tr('Перевірити')}
                </button>
              </Row>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The row's label names the control inside it for screen readers (sliders, switches have no text of their own). */
const RowLabel = createContext('')

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <RowLabel.Provider value={label}>
    <div className="settings__row">
      <div className="settings__label">
        {label}
        {hint && <span className="settings__hint">{hint}</span>}
      </div>
      <div className="settings__control">{children}</div>
    </div>
    </RowLabel.Provider>
  )
}

function Slider(props: { min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const label = useContext(RowLabel)
  return (
    <input
      type="range"
      aria-label={label || undefined}
      className="settings__slider"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const label = useContext(RowLabel)
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label || undefined}
      className={`settings__toggle${value ? ' is-on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="settings__segmented">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'is-active' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}
