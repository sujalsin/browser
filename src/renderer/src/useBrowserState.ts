import { useEffect, useState } from 'react'
import type { UIState } from '../../shared/types'

/** Latest state snapshot pushed by the main process. */
export function useBrowserState(): UIState | null {
  const [state, setState] = useState<UIState | null>(null)
  useEffect(() => {
    let alive = true
    const off = window.browser.onState((s) => alive && setState(s))
    void window.browser.getState().then((s) => alive && s && setState((prev) => prev ?? s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

export const dispatch = window.browser.dispatch
