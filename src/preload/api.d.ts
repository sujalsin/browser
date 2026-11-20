import type { Action, Query, UIState } from '../shared/types'

declare global {
  interface Window {
    browser: {
      getState(): Promise<UIState | null>
      dispatch(action: Action): void
      query<T = unknown>(q: Query): Promise<T>
      onState(cb: (state: UIState) => void): () => void
    }
  }
}

export {}
