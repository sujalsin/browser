// State shared between the main process (source of truth) and the UI.

export interface Space {
  id: string
  name: string
  /** Accent color used to tint the sidebar. */
  color: string
  /** Electron session partition (one cookie jar / profile). Spaces can share one. */
  partition: string
  /** Pinned section, in order: tab ids and folder ids. */
  pinned: string[]
  /** Today section, in order: tab ids and folder ids. */
  today: string[]
  /** Tab to show when switching back to this space. */
  lastTabId: string | null
}

/** Where a tab lives: favorites (per profile), pinned, or Today (per space). */
export type TabKind = 'favorite' | 'pinned' | 'today'

export interface Tab {
  id: string
  /** Owning space. For favorites: a space using the profile the favorite belongs to. */
  spaceId: string
  url: string
  title: string
  favicon?: string
  kind: TabKind
  /** Set when the tab is inside a folder. */
  folderId?: string
  /** For pinned tabs and favorites: the URL the tab returns to when unloaded. */
  pinnedUrl?: string
  createdAt: number
  lastActiveAt: number
}

export interface Folder {
  id: string
  spaceId: string
  name: string
  collapsed: boolean
  /** Tab ids, in order. Folders don't nest. */
  children: string[]
  /** Created by Tidy: Tidy may regroup it. */
  auto?: boolean
}

/** A list in the sidebar that items can be moved into. */
export type ListRef = { type: 'favorites' } | { type: 'pinned' } | { type: 'today' } | { type: 'folder'; id: string }

/** Live info about a tab whose page is loaded. Never persisted. */
export interface TabRuntime {
  loaded: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  muted: boolean
  /** Ads/trackers blocked on the current page. */
  blocked: number
  /** Set when the main frame failed to load (DNS error, offline, …). */
  error?: { code: number; description: string; url: string }
}

/** A page in history. */
export interface HistoryItem {
  url: string
  title: string
  favicon?: string | null
  visitCount: number
  lastVisit: number
}

export interface DownloadInfo {
  id: string
  url: string
  filename: string
  path: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  paused: boolean
  received: number
  total: number
  startedAt: number
  endedAt?: number
}

/** A remembered Allow/Block answer to a site's permission request. */
export interface SitePermission {
  /** Profile (session partition) the decision applies to. */
  partition: string
  origin: string
  permission: string
  allowed: boolean
  updated: number
}

export interface ArchivedTab {
  url: string
  title: string
  favicon?: string
  spaceId: string
  archivedAt: number
}

export interface ClosedTab {
  url: string
  title: string
  favicon?: string
  spaceId: string
  kind: TabKind
  /** Where it was, to put it back there. */
  list: ListRef
  index: number
  pinnedUrl?: string
}

/** What gets written to disk. */
export interface PersistedState {
  version: 2
  spaces: Space[]
  activeSpaceId: string
  /** All tabs, by id lookup. Order lives in Space.pinned/today, Folder.children and favorites. */
  tabs: Tab[]
  folders: Folder[]
  /** Favorite tab ids per profile (session partition). */
  favorites: Record<string, string[]>
  activeTabId: string | null
  archive: ArchivedTab[]
  sidebarVisible: boolean
  searchEngine: SearchEngineId
  settings: Settings
  shields: ShieldsSettings
}

/** Brave-style protections. */
export interface ShieldsSettings {
  /** Master switch for ad and tracker blocking. */
  enabled: boolean
  /** Sites (registrable domains, e.g. "example.com") where Shields are off. */
  disabledSites: string[]
  /** Also block cookie consent banners (adds cookie-notice filter lists). */
  blockCookieBanners: boolean
  /** Try https:// first for http:// links, falling back if it fails. */
  upgradeHttps: boolean
  /** Remove click-tracking parameters (fbclid, gclid, …) from links. */
  stripTrackingParams: boolean
}

export interface ShieldsStatus {
  /** Filter engine loaded and blocking. */
  ready: boolean
  /** When the filter lists were last downloaded (ms since epoch). */
  updatedAt?: number
  updating: boolean
  error?: string
  filterCount?: number
}

export interface Settings {
  /** Unload background tabs after this many idle minutes. 0 = never. */
  sleepAfterMinutes: number
  /** Make sites (YouTube) send H.264 video, which Intel Macs decode in hardware. */
  preferH264: boolean
  /** Archive Today tabs not used for this many hours (Arc default 12). 0 = never. */
  archiveAfterHours: number
}

/** What the UI receives. */
export interface UIState extends PersistedState {
  runtime: Record<string, TabRuntime>
  commandBar: CommandBarState | null
  htmlFullscreen: boolean
  platform: string
  /** Sidebar temporarily shown over the page while it is hidden (hover at left edge). */
  peek: boolean
  shieldsStatus: ShieldsStatus
  /** Whether Shields are on for the active tab's site. */
  activeShieldsOn: boolean
  /** A space or folder whose name is being edited inline (just created, or "Rename…"). */
  editing: { type: 'space' | 'folder'; id: string } | null
  /** Recent downloads, newest first. */
  downloads: DownloadInfo[]
  /** A download finished since the Downloads list was last opened. */
  downloadsUnseen: boolean
  /** The Library (History / Downloads / Settings) overlay, when open. */
  library: { tab: LibraryTab } | null
  /** Find-in-page bar for the active tab, when open. */
  find: FindState | null
}

export type LibraryTab = 'history' | 'downloads' | 'settings'

export interface FindState {
  query: string
  /** 1-based index of the highlighted match, 0 if none. */
  active: number
  total: number
  /** Bumped each time ⌘F is pressed, so the bar refocuses its input. */
  focusToken: number
}

export interface CommandBarState {
  /** 'new' opens a new tab, 'edit' navigates the current tab. */
  mode: 'new' | 'edit'
  initialInput: string
}

export type SearchEngineId = 'google' | 'duckduckgo' | 'kagi' | 'brave'

export type Action =
  | { type: 'tab.activate'; id: string }
  | { type: 'tab.close'; id: string }
  | { type: 'tab.open'; input: string; mode: 'new' | 'edit' }
  | { type: 'tab.togglePin'; id: string }
  | { type: 'tab.toggleFavorite'; id: string }
  | { type: 'item.move'; id: string; to: ListRef; index: number }
  | { type: 'space.switch'; id: string }
  | { type: 'space.cycle'; delta: 1 | -1 }
  | { type: 'space.addMenu' }
  | { type: 'space.menu'; id: string }
  | { type: 'space.rename'; id: string; name: string }
  | { type: 'folder.toggle'; id: string }
  | { type: 'folder.rename'; id: string; name: string }
  | { type: 'folder.menu'; id: string }
  | { type: 'folder.create'; list: 'pinned' | 'today' }
  | { type: 'edit.cancel' }
  | { type: 'tabs.tidy' }
  | { type: 'library.open'; tab: LibraryTab }
  | { type: 'library.close' }
  | { type: 'download.act'; id: string; op: 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove' | 'retry' }
  | { type: 'downloads.clear' }
  | { type: 'history.delete'; url: string }
  | { type: 'history.clear'; since: number }
  | { type: 'settings.update'; patch: Partial<Settings> }
  | { type: 'searchEngine.set'; id: SearchEngineId }
  | { type: 'shields.update'; patch: Partial<ShieldsSettings> }
  | { type: 'permissions.forget'; partition: string; origin: string; permission: string }
  | { type: 'browser.makeDefault' }
  | { type: 'data.clear'; what: 'cache' | 'cookies' }
  | { type: 'arc.import' }
  | { type: 'find.open' }
  | { type: 'find.query'; text: string; forward?: boolean; next?: boolean }
  | { type: 'find.close' }
  | { type: 'tab.contextMenu'; id: string }
  | { type: 'nav.back' }
  | { type: 'nav.forward' }
  | { type: 'nav.reload' }
  | { type: 'commandBar.open'; mode: 'new' | 'edit' }
  | { type: 'commandBar.close' }
  | { type: 'sidebar.toggle' }
  | { type: 'sidebar.peek'; open: boolean }
  | { type: 'tab.sleep'; id: string }
  | { type: 'shields.menu' }
  | { type: 'tabs.clearToday' }
  | { type: 'archive.restore'; index: number }

/** Requests from the UI that return data (too big or too dynamic for UIState). */
export type Query =
  | { type: 'history.suggest'; input: string }
  | { type: 'history.list'; query?: string; before?: number }
  | { type: 'permissions.list' }
  | { type: 'app.info' }

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  isDefaultBrowser: boolean
  arcFound: boolean
  historyCount: number
}

export const IPC = {
  state: 'browser:state',
  action: 'browser:action',
  getState: 'browser:get-state',
  query: 'browser:query',
} as const
