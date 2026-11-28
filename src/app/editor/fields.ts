/**
 * CodeMirror state fields Obsidian exports so editor extensions can find their note:
 * `state.field(editorInfoField)` is the view (with `app`, `file`, `editor`).
 */
import { StateField } from '@codemirror/state'

const constant = <T>(initial: T) => StateField.define<T>({ create: () => initial, update: (v) => v })

export const editorInfoField = constant<any>(null)
/** @deprecated in Obsidian, same value as editorInfoField */
export const editorViewField = editorInfoField
export const editorLivePreviewField = constant(true)
