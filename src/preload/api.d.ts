import type { Action, LittleState, Query, UIState } from '../shared/types'

declare global {
  interface Window {
    browser: {
      getState(): Promise<UIState | null>
      dispatch(action: Action): void
      query<T = unknown>(q: Query): Promise<T>
      onState(cb: (state: UIState) => void): () => void
      onLittleState(cb: (state: LittleState) => void): () => void
    }
  }
}

export {}
