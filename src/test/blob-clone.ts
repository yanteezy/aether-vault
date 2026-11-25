// fake-indexeddb copies stored values with Node's structuredClone, which turns jsdom's Blob into a plain object
// (a real webview keeps it a Blob). Blobs are immutable, so handing the same one back is a faithful copy.
// Must run before fake-indexeddb is imported.
const original = globalThis.structuredClone
globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) =>
  typeof Blob !== 'undefined' && value instanceof Blob ? value : original(value, options)) as typeof structuredClone
