import type { Action, UIState } from '../shared/types'

declare global {
  interface Window {
    browser: {
      getState(): Promise<UIState | null>
      dispatch(action: Action): void
      onState(cb: (state: UIState) => void): () => void
    }
  }
}

export {}
