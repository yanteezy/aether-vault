import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

// tell React this is a test environment, so act() flushes updates and effects
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A tiny renderHook over react-dom (no @testing-library dependency). */
export function renderHook<T>(hook: () => T) {
  const result = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  return { result, unmount: () => act(() => root.unmount()) }
}
