import { useState, type CSSProperties } from 'react'
import { SIDEBAR_WIDTH, VIEW_GAP } from '../../shared/constants'
import type { Tab, TabRuntime, UIState } from '../../shared/types'
import { displayHost } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
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

export function Sidebar({ state }: { state: UIState }) {
  const [showArchive, setShowArchive] = useState(false)
  const tabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId)
  const pinned = tabs.filter((t) => t.pinned)
  const today = tabs.filter((t) => !t.pinned)
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const rt = active ? state.runtime[active.id] : undefined
  const space = state.spaces.find((s) => s.id === state.activeSpaceId)!
  const partition = space.partition

  return (
    <aside className="sidebar">
      <header className="sidebar-top">
        <div className="traffic-light-space" />
        <div className="nav-buttons">
          <button className="icon-btn" title="Toggle sidebar (⌘S)" onClick={() => dispatch({ type: 'sidebar.toggle' })}>
            <Icon name="sidebar" />
          </button>
          <button className="icon-btn" title="Back (⌘[)" disabled={!rt?.canGoBack} onClick={() => dispatch({ type: 'nav.back' })}>
            <Icon name="back" />
          </button>
          <button className="icon-btn" title="Forward (⌘])" disabled={!rt?.canGoForward} onClick={() => dispatch({ type: 'nav.forward' })}>
            <Icon name="forward" />
          </button>
          <button className="icon-btn" title="Reload (⌘R)" disabled={!rt} onClick={() => dispatch({ type: 'nav.reload' })}>
            <Icon name="reload" />
          </button>
        </div>
      </header>

      <div className="url-row">
        <button className="url-pill" title="Edit URL (⌘L)" onClick={() => dispatch({ type: 'commandBar.open', mode: active ? 'edit' : 'new' })}>
          {active ? (
            <>
              {active.url.startsWith('https://') && <Icon name="lock" size={12} />}
              <span className="url-text">{displayHost(active.url)}</span>
            </>
          ) : (
            <span className="url-placeholder">Search or enter URL…</span>
          )}
        </button>
        <ShieldsButton state={state} />
      </div>

      <div className="extensions-row">
        <browser-action-list partition={partition} alignment="bottom right" />
      </div>

      <div className="tab-scroll">
        {pinned.length > 0 && (
          <ul className="tab-list pinned">
            {pinned.map((t) => (
              <TabRow key={t.id} tab={t} state={state} />
            ))}
          </ul>
        )}

        <div className="divider-row">
          <div className="divider" />
          {today.length > 0 && (
            <button className="clear-btn" title="Archive all Today tabs (⇧⌘K)" onClick={() => dispatch({ type: 'tabs.clearToday' })}>
              <Icon name="arrowDown" size={11} /> Clear
            </button>
          )}
        </div>

        <button className="new-tab-row" onClick={() => dispatch({ type: 'commandBar.open', mode: 'new' })}>
          <Icon name="plus" /> New Tab
        </button>

        <ul className="tab-list">
          {today.map((t) => (
            <TabRow key={t.id} tab={t} state={state} />
          ))}
        </ul>
      </div>

      {showArchive && <ArchivePanel state={state} />}

      <footer className="sidebar-bottom">
        <span className="space-name">
          <span className="space-dot" /> {space.name}
        </span>
        <button className={`icon-btn ${showArchive ? 'on' : ''}`} title="Archived tabs" onClick={() => setShowArchive((v) => !v)}>
          <Icon name="archive" />
        </button>
      </footer>
    </aside>
  )
}

function TabRow({ tab, state }: { tab: Tab; state: UIState }) {
  const rt = state.runtime[tab.id]
  const isActive = state.activeTabId === tab.id
  // Pinned tabs only show a button when loaded (it unloads them, like Arc).
  const showClose = !tab.pinned || rt?.loaded

  return (
    <li
      className={`tab-row ${isActive ? 'active' : ''} ${rt ? '' : 'asleep'}`}
      onMouseDown={(e) => {
        if (e.button === 0) dispatch({ type: 'tab.activate', id: tab.id })
      }}
      onAuxClick={(e) => {
        if (e.button === 1) dispatch({ type: 'tab.close', id: tab.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'tab.contextMenu', id: tab.id })
      }}
      title={tab.url}
    >
      <Favicon src={tab.favicon} loading={rt?.loading} url={tab.url} />
      <span className="tab-title">{tab.title || displayHost(tab.url)}</span>
      {rt?.audible && <Icon name={rt.muted ? 'muted' : 'speaker'} size={13} className="tab-audio" />}
      {showClose && (
        <button
          className="tab-close"
          title={tab.pinned ? 'Unload tab' : 'Close tab (⌘W)'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => dispatch({ type: 'tab.close', id: tab.id })}
        >
          <Icon name={tab.pinned ? 'minus' : 'close'} size={12} />
        </button>
      )}
    </li>
  )
}

function ArchivePanel({ state }: { state: UIState }) {
  const items = state.archive
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.spaceId === state.activeSpaceId)
    .slice(0, 50)
  return (
    <div className="archive-panel">
      <div className="archive-title">Archive</div>
      {items.length === 0 && <div className="archive-empty">Cleared tabs show up here.</div>}
      <ul className="tab-list">
        {items.map(({ item, index }) => (
          <li key={`${index}-${item.archivedAt}`} className="tab-row" onClick={() => dispatch({ type: 'archive.restore', index })} title={item.url}>
            <Favicon src={item.favicon} url={item.url} />
            <span className="tab-title">{item.title || displayHost(item.url)}</span>
          </li>
        ))}
      </ul>
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

function ShieldsButton({ state }: { state: UIState }) {
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const blocked = active ? (state.runtime[active.id]?.blocked ?? 0) : 0
  const on = state.activeShieldsOn
  const title = !state.shieldsStatus.ready
    ? 'Shields: downloading filter lists…'
    : on
      ? `Shields: ${blocked} blocked on this page`
      : 'Shields are off for this site'
  return (
    <button className={`shields-btn ${on ? '' : 'off'}`} title={title} onClick={() => dispatch({ type: 'shields.menu' })}>
      <Icon name={on ? 'shield' : 'shieldOff'} size={15} />
      {on && blocked > 0 && <span className="shields-count">{blocked > 99 ? '99+' : blocked}</span>}
    </button>
  )
}
