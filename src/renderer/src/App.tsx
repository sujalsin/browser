import type { CSSProperties } from 'react'
import { SIDEBAR_WIDTH, VIEW_GAP } from '../../shared/constants'
import type { TabRuntime, UIState } from '../../shared/types'
import { displayHost } from '../../shared/url'
import { Sidebar } from './Sidebar'
import { dispatch, useBrowserState } from './useBrowserState'

/** CSS variables shared by the window UI and the overlay. */
export function themeStyle(state: UIState): CSSProperties {
  const space = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0]
  return {
    '--space': space.color,
    '--sidebar-width': `${SIDEBAR_WIDTH}px`,
    '--gap': `${VIEW_GAP}px`,
  } as CSSProperties
}

export function App() {
  const state = useBrowserState()
  if (!state) return null
  const hidden = !state.sidebarVisible && !state.htmlFullscreen

  return (
    <div className={`window ${state.platform}`} style={themeStyle(state)}>
      {state.sidebarVisible && !state.htmlFullscreen && <Sidebar state={state} />}
      {/* Sidebar hidden: hovering the left edge slides it in over the page. */}
      {hidden && <div className="edge-reveal" onMouseEnter={() => dispatch({ type: 'sidebar.peek', open: true })} />}
      <main className="content" style={{ left: state.sidebarVisible ? SIDEBAR_WIDTH : VIEW_GAP }}>
        <div className="drag-strip" />
        {!state.activeTabId && <EmptyState />}
        {state.activeTabId && state.runtime[state.activeTabId]?.error && <LoadError error={state.runtime[state.activeTabId].error!} />}
      </main>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>Nothing open</h1>
        <p>
          Press <kbd>⌘</kbd> <kbd>T</kbd> to open a tab.
        </p>
        <button className="primary-btn" onClick={() => dispatch({ type: 'commandBar.open', mode: 'new' })}>
          New Tab
        </button>
      </div>
    </div>
  )
}

function LoadError({ error }: { error: NonNullable<TabRuntime['error']> }) {
  const offline = /INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|TUNNEL|PROXY|CONNECTION/.test(error.description)
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>{offline ? 'Can’t reach this site' : 'This page didn’t load'}</h1>
        <p className="error-url">{displayHost(error.url)}</p>
        <p className="error-code">{error.description}</p>
        <button className="primary-btn" onClick={() => dispatch({ type: 'nav.reload' })}>
          Try Again
        </button>
      </div>
    </div>
  )
}
