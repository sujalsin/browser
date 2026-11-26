import type { Tab, UIState } from '../../shared/types'
import { displayHost } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { dispatch } from './useBrowserState'

const MAX_TILES = 8
const MAX_CLOSED = 5

function greeting(hour: number): string {
  if (hour < 5) return 'Good evening' // still last night, as far as the person awake is concerned
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The tabs you keep (favorites, then pinned, folders included), in sidebar order. */
function keptTabs(state: UIState): Tab[] {
  const space = state.spaces.find((s) => s.id === state.activeSpaceId)
  if (!space) return []
  const byId = new Map(state.tabs.map((t) => [t.id, t]))
  const folders = new Map(state.folders.map((f) => [f.id, f]))
  const ids = [...(state.favorites[space.partition] ?? []), ...space.pinned.flatMap((id) => folders.get(id)?.children ?? [id])]
  return ids.flatMap((id) => byId.get(id) ?? []).slice(0, MAX_TILES)
}

/** What the page area shows when no tab is open: a place to start from. */
export function StartPage({ state }: { state: UIState }) {
  const space = state.spaces.find((s) => s.id === state.activeSpaceId)
  const isPrivate = !!space?.private
  const now = new Date()
  const tiles = keptTabs(state)
  const closed = state.archive
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.spaceId === state.activeSpaceId)
    .slice(0, MAX_CLOSED)

  return (
    <div className="empty-state start">
      <div className="start-column">
        <header className="start-head">
          <h1>{isPrivate ? 'Private browsing' : greeting(now.getHours())}</h1>
          <p>{isPrivate ? 'Nothing you do here is saved.' : now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </header>

        <button className="start-search" onClick={() => dispatch({ type: 'commandBar.open', mode: 'new' })}>
          <Icon name="search" size={17} />
          <span>Search or enter URL…</span>
          <kbd>⌘</kbd>
          <kbd>T</kbd>
        </button>

        {isPrivate && (
          <p className="private-note">
            Pages you open here aren’t added to history, and cookies and logins are discarded when you close this space. Downloads you keep stay on your
            Mac. Extensions are off. Websites and your network can still see what you do.
          </p>
        )}

        {tiles.length > 0 && (
          <section className="start-tiles">
            {tiles.map((tab) => (
              <button key={tab.id} className="start-tile" title={tab.url} onClick={() => dispatch({ type: 'tab.activate', id: tab.id })}>
                <span className="start-tile-icon">
                  <Favicon src={tab.favicon} url={tab.url} />
                </span>
                <span className="start-tile-name">{tab.title || displayHost(tab.url)}</span>
              </button>
            ))}
          </section>
        )}

        {closed.length > 0 && (
          <section className="start-list">
            <h2>Recently closed</h2>
            {closed.map(({ item, index }) => (
              <button key={`${index}-${item.archivedAt}`} className="start-row" title={item.url} onClick={() => dispatch({ type: 'archive.restore', index })}>
                <Favicon src={item.favicon} url={item.url} />
                <span className="start-row-title">{item.title || displayHost(item.url)}</span>
                <span className="start-row-host">{displayHost(item.url)}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
