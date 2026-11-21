/** Note fonts: system font stacks that exist on macOS and Windows (nothing is downloaded). */
export type NoteFont = 'auto' | 'system' | 'serif' | 'rounded' | 'mono' | 'typewriter' | 'hand'

/** label = Ukrainian source string (translated via t()). */
export const NOTE_FONTS: { id: NoteFont; label: string; stack: string }[] = [
  { id: 'auto', label: 'Як у темі', stack: '' },
  { id: 'system', label: 'Системний', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif" },
  { id: 'serif', label: 'Із засічками', stack: "'New York', 'Iowan Old Style', Charter, Georgia, 'Cambria', 'Times New Roman', serif" },
  { id: 'rounded', label: 'Округлий', stack: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Segoe UI Variable Display', 'Segoe UI', sans-serif" },
  { id: 'mono', label: 'Моноширинний', stack: "ui-monospace, 'SF Mono', Menlo, 'Cascadia Mono', Consolas, monospace" },
  { id: 'typewriter', label: 'Друкарська машинка', stack: "'American Typewriter', 'Courier New', Courier, monospace" },
  { id: 'hand', label: 'Рукописний', stack: "'Bradley Hand', Noteworthy, 'Segoe Print', 'Ink Free', 'Comic Sans MS', cursive" },
]

export const fontStack = (id: NoteFont | undefined) => NOTE_FONTS.find((f) => f.id === id)?.stack ?? ''
