import type { CSSProperties } from 'react'
import { SIDEBAR_TOP_HEIGHT, SIDEBAR_WIDTH, VIEW_GAP, pageFrame } from '../../shared/constants'
import type { TabRuntime, UIState } from '../../shared/types'
import { displayHost } from '../../shared/url'
import { Icon } from './Icon'
import { Sidebar } from './Sidebar'
import { dispatch, useBrowserState } from './useBrowserState'

/** Class names every surface's root shares: the system, full screen, private browsing. */
export function rootClass(state: UIState): string {
  const isPrivate = !!state.spaces.find((s) => s.id === state.activeSpaceId)?.private
  return `${state.platform} ${state.fullscreen ? 'fullscreen' : ''} ${isPrivate ? 'private' : ''}`
}

/** CSS variables shared by the window UI and the overlay. */
export function themeStyle(state: UIState): CSSProperties {
  const space = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0]
  const frame = pageFrame(state.fullscreen)
  const style: Record<string, string> = {
    '--space': space.color,
    '--sidebar-width': `${SIDEBAR_WIDTH}px`,
    // The frame around the page (none in full screen)…
    '--gap': `${frame.gap}px`,
    '--radius-page': `${frame.radius}px`,
    // …and how far floating panels sit in from the window's edge (always).
    '--float': `${VIEW_GAP}px`,
    '--top': `${SIDEBAR_TOP_HEIGHT}px`,
  }
  // A second color turns the frame into a gradient, like Arc's space themes.
  if (space.gradient) {
    style['--frame-bg'] =
      `linear-gradient(165deg, color-mix(in oklab, ${space.color} 30%, var(--base)), color-mix(in oklab, ${space.gradient} 30%, var(--base)))`
  }
  return style as CSSProperties
}

export function App() {
  const state = useBrowserState()
  if (!state) return null
  const hidden = !state.sidebarVisible && !state.htmlFullscreen
  const isPrivate = !!state.spaces.find((s) => s.id === state.activeSpaceId)?.private

  return (
    <div className={`window ${rootClass(state)}`} style={themeStyle(state)}>
      {state.sidebarVisible && !state.htmlFullscreen && <Sidebar state={state} />}
      {/* Sidebar hidden: hovering the left edge slides it in over the page. */}
      {hidden && <div className="edge-reveal" onMouseEnter={() => dispatch({ type: 'sidebar.peek', open: true })} />}
      <main className="content" style={{ left: state.sidebarVisible ? SIDEBAR_WIDTH : pageFrame(state.fullscreen).gap }}>
        <div className="drag-strip" />
        {/* In split view each page fills its own half; there is no single card to draw. */}
        {!state.splitView && <div className="page-card" />}
        {!state.activeTabId && <EmptyState isPrivate={isPrivate} />}
        {state.activeTabId && !state.splitView && state.runtime[state.activeTabId]?.error && <LoadError error={state.runtime[state.activeTabId].error!} />}
      </main>
      {state.splitView && <SplitChrome state={state} />}
    </div>
  )
}

function EmptyState({ isPrivate }: { isPrivate: boolean }) {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-mark">
          <Icon name={isPrivate ? 'private' : 'tab'} size={24} />
        </div>
        <h1>{isPrivate ? 'Private browsing' : 'Nothing open'}</h1>
        {isPrivate && (
          <p className="private-note">
            Pages you open here aren’t added to history, and cookies and logins are discarded when you close this space. Downloads you keep stay on your
            Mac. Extensions are off. Websites and your network can still see what you do.
          </p>
        )}
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
        <div className="empty-mark">
          <Icon name="globe" size={24} />
        </div>
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

/** Split view: a ring around the active pane and a draggable divider between the two. */
function SplitChrome({ state }: { state: UIState }) {
  const split = state.splitView!
  const [a, b] = split.panes
  const active = split.panes.find((p) => p.tabId === state.activeTabId)
  return (
    <>
      {active && (
        <div
          className="split-ring"
          style={{ left: active.x - 2, top: active.y - 2, width: active.width + 4, height: active.height + 4 }}
        />
      )}
      <div
        className="split-divider"
        title="Drag to resize · double-click to reset"
        style={{ left: a.x + a.width, top: a.y, width: b.x - (a.x + a.width), height: a.height }}
        onMouseDown={(e) => {
          e.preventDefault()
          dispatch({ type: 'split.drag', active: true })
        }}
        onDoubleClick={() => dispatch({ type: 'split.resize', id: split.id, ratio: 0.5 })}
      >
        <span className="split-grip" />
      </div>
    </>
  )
}
