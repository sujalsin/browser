// State shared between the main process (source of truth) and the UI.

export interface Space {
  id: string
  name: string
  /** Accent color used to tint the sidebar. */
  color: string
  /** Electron session partition (one cookie jar / profile). */
  partition: string
}

export interface Tab {
  id: string
  spaceId: string
  url: string
  title: string
  favicon?: string
  pinned: boolean
  /** For pinned tabs: the URL the tab returns to when it is unloaded. */
  pinnedUrl?: string
  createdAt: number
  lastActiveAt: number
}

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
  pinned: boolean
  index: number
}

/** What gets written to disk. */
export interface PersistedState {
  version: 1
  spaces: Space[]
  activeSpaceId: string
  /** Tab order within a space = order in this array. */
  tabs: Tab[]
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

export const IPC = {
  state: 'browser:state',
  action: 'browser:action',
  getState: 'browser:get-state',
} as const
