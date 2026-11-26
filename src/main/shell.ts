import { BrowserWindow, Menu, WebContentsView, app, clipboard, components, dialog, nativeTheme, screen, session, shell as electronShell, systemPreferences, type WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir, totalmem } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { SIDEBAR_TOP_HEIGHT, SIDEBAR_WIDTH, SPACE_COLORS, VIEW_GAP, VIEW_RADIUS, pageFrame } from '../shared/constants'
import type {
  Action,
  AppInfo,
  Boost,
  ClosedTab,
  CommandBarState,
  FindState,
  LibraryTab,
  ListRef,
  PersistedState,
  Query,
  Settings,
  ShieldsSettings,
  Tab,
  TabRuntime,
  TaskInfo,
  UIState,
} from '../shared/types'
import { IPC } from '../shared/types'
import { SEARCH_ENGINES, displayHost, resolveInput } from '../shared/url'
import { boostsFor, hideRule, normalizeDomain, selectorScript, wrapBoostScript } from '../shared/boosts'
import { LANGUAGES, googleTranslatePageUrl, languageName } from '../shared/translate'
import { attachWebContextMenu } from './context-menu'
import { getExtensions, setExtensionsShell } from './extensions'
import {
  activeSpace,
  addTab,
  archiveTab,
  clearToday,
  createFolder,
  favoritesOf,
  folderById,
  isPrivateTab,
  kindFor,
  listArray,
  locate,
  moveItem,
  removeFolder,
  removeTab,
  sidebarOrder,
  spaceById,
  staleTodayTabs,
  tabById,
  tidy,
  type Location,
} from './model'
import { ARC_DEFAULT_PROFILE, applyArcPlan, arcHistoryPath, countPlan, parseArcSidebar, readArcHistory } from './arc-import'
import type { BrowserDB } from './db'
import type { Downloads } from './downloads'
import { forgetPartitionPermissions, forgetPermission } from './permissions'
import { pagePreferences } from './page-prefs'
import { WINDOW_BUTTONS, windowButtons } from '../shared/window-buttons'
import { LittleWindow } from './little'
import { Shields } from './shields'
import { pictureInPicture } from './pip'
import { showSiteInfo } from './site-info'
import { restorePage, translatePage } from './translate'
import { flushState, saveState } from './store'

/** How long the page takes to slide when the sidebar is shown or hidden. */
const SIDEBAR_SLIDE_MS = 180
const MAX_CLOSED = 25

/** What Chromium hands over when a page opens a window: the new page itself, and the size it asked for. */
type PopupOptions = Electron.BrowserWindowConstructorOptions & { webContents: WebContents }
const NEW_TAB_TITLE = 'New Tab'
/** How often the sidebar UI is refreshed at most. Keeps busy pages cheap. */
const EMIT_INTERVAL_MS = 50
const SLEEP_CHECK_MS = 60_000
/**
 * How many pages may stay loaded at once before the least recently used ones
 * are put to sleep early: about 2 per GB of RAM (16 on an 8 GB Mac).
 */
const MAX_LOADED_TABS = Math.min(40, Math.max(8, Math.round((totalmem() / 2 ** 30) * 2)))
/** The find bar's own small page is freed after this long unused (~80 MB). */
const FIND_VIEW_IDLE_MS = 60_000
/** The UI only needs recent archive entries; the full list stays on disk. */
const ARCHIVE_IN_SNAPSHOT = 100

/** Where Arc keeps its sidebar (spaces, pinned tabs, favorites). */
export const ARC_SIDEBAR_FILE = join(homedir(), 'Library', 'Application Support', 'Arc', 'StorableSidebar.json')


interface OpenOptions {
  activate?: boolean
  /** Insert directly after this tab (links opened from a page). */
  afterTabId?: string
}

/**
 * One browser window: the React UI fills the window, and each loaded tab is a
 * WebContentsView laid over the content area. The command bar is a transparent
 * overlay view on top of everything.
 */
export class BrowserShell {
  readonly win: BrowserWindow
  private overlay: WebContentsView | null = null
  private views = new Map<string, WebContentsView>()
  private runtime: Record<string, TabRuntime> = {}
  private commandBar: CommandBarState | null = null
  /** Tab whose page is in HTML fullscreen (video), if any. */
  private fullscreenTab: string | null = null
  private closed: ClosedTab[] = []
  /** Tabs on screen: the active one, plus its split partner. */
  private attached: string[] = []
  private splitDragging = false
  /** Peek: a page previewed in a floating card over the content. */
  private previewView: WebContentsView | null = null
  private preview: { url: string; title: string; loading: boolean; canGoBack: boolean } | null = null
  /** ⌃⇧= was pressed: the next tab opened from the command bar joins a split with this one. */
  private pendingSplitWith: string | null = null
  /** True while registering a view with the extension system (see createView). */
  registeringTab = false
  private emitTimer: NodeJS.Timeout | null = null
  private lastEmit = 0
  private peek = false
  /** Back/forward history of sleeping tabs, so waking them keeps it. */
  private sleptHistory = new Map<string, { entries: Electron.NavigationEntry[]; index: number }>()
  /** Tabs the user has typed into since their last navigation: never put to sleep. */
  private typedIn = new Set<string>()
  private sleepTimer: NodeJS.Timeout
  /** Called when settings change (menu checkmarks, session preloads). */
  onSettingsChanged: (settings: Settings) => void = () => {}
  /** Ad/tracker blocking; set by the app once created. */
  shields: Shields | null = null
  /** Set up a new profile's session (permissions, Shields, extensions). Provided by the app. */
  prepareSession: (partition: string, opts?: { private?: boolean }) => Promise<void> = async () => {}
  /** Space or folder name being edited inline in the sidebar. */
  private editing: UIState['editing'] = null
  /** History, downloads and permissions storage; set by the app. */
  db: BrowserDB | null = null
  downloads: Downloads | null = null
  private library: UIState['library'] = null
  private downloadsUnseen = false
  private seenCompleted = 0
  private find: FindState | null = null
  private findView: WebContentsView | null = null

  /** Run a storage call without letting a database problem break browsing. */
  private record(fn: (db: BrowserDB) => void) {
    if (!this.db) return
    try {
      fn(this.db)
    } catch (err) {
      console.error('History write failed:', err)
    }
  }

  /** Wire Shields events (blocked counts, list status) into this window's UI. */
  attachShields(shields: Shields) {
    this.shields = shields
    shields.onStatus = () => this.emit(false)
    shields.onBlocked = (wcId) => {
      for (const [id, view] of this.views) {
        if (view.webContents.id === wcId) {
          const rt = this.runtime[id]
          if (rt) {
            rt.blocked++
            this.emit(false)
          }
          return
        }
      }
    }
  }

  constructor(
    private state: PersistedState,
    private readonly rendererUrl: string,
  ) {
    const isMac = process.platform === 'darwin'
    setExtensionsShell(this)
    this.win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: 'Browser',
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      trafficLightPosition: WINDOW_BUTTONS,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1b22' : '#e9e7f2',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    this.win.loadURL(this.rendererUrl)
    this.win.once('ready-to-show', () => this.win.show())
    this.win.on('resize', () => this.layout())
    for (const ev of ['enter-full-screen', 'leave-full-screen'] as const) {
      this.win.on(ev as 'enter-full-screen', () => {
        this.applyWindowButtons()
        this.syncEdgeWatch()
        this.layout()
        this.emit() // the sidebar drops the gap it leaves for the window buttons
      })
    }
    this.syncEdgeWatch() // a window can open already in full screen
    this.win.on('close', () => {
      this.closing = true
      saveState(this.state)
      flushState()
    })
    this.win.on('closed', () => {
      clearInterval(this.sleepTimer)
      if (this.slide) clearInterval(this.slide.timer)
      this.stopPeekWatch()
      if (this.edgeWatch) clearInterval(this.edgeWatch)
      if (this.findIdleTimer) clearTimeout(this.findIdleTimer)
      for (const req of this.authQueue.splice(0)) req.callback()
      if (this.findView && !this.findView.webContents.isDestroyed()) this.findView.webContents.close()
      if (this.emitTimer) clearTimeout(this.emitTimer)
      // Tab views are not owned by the window; tear them down explicitly.
      for (const id of [...this.views.keys()]) this.unload(id)
      if (this.overlay && !this.overlay.webContents.isDestroyed()) this.overlay.webContents.close()
      if (this.previewView && !this.previewView.webContents.isDestroyed()) this.previewView.webContents.close()
    })
    this.win.webContents.on('did-finish-load', () => this.emitNow())
    this.sleepTimer = setInterval(() => this.sleepIdleTabs(), SLEEP_CHECK_MS)
    this.applyWindowButtons()
    this.layout()
  }

  /** Load the tab that was active last time. Called once extensions are ready. */
  restoreActiveTab() {
    if (this.state.activeTabId && !this.attached.length) this.activate(this.state.activeTabId)
  }

  // ───────────────────────────── state helpers ─────────────────────────────

  currentPartition(): string {
    return this.space().partition
  }

  private space() {
    return activeSpace(this.state)
  }

  /** The session (profile) a tab's page runs in. */
  private partitionOf(tab: Tab): string {
    return spaceById(this.state, tab.spaceId)?.partition ?? this.space().partition
  }

  private tab(id: string | null | undefined): Tab | undefined {
    return tabById(this.state, id)
  }

  activeTab(): Tab | undefined {
    return this.tab(this.state.activeTabId)
  }

  activeWebContents(): WebContents | undefined {
    const id = this.state.activeTabId
    return id ? this.views.get(id)?.webContents : undefined
  }

  webContentsForTab(id: string): WebContents | undefined {
    return this.views.get(id)?.webContents
  }

  tabIdForWebContents(wc: WebContents): string | undefined {
    for (const [id, view] of this.views) if (view.webContents === wc) return id
    return undefined
  }

  isUIWebContents(wc: WebContents): boolean {
    return wc === this.win.webContents || wc === this.overlay?.webContents || wc === this.findView?.webContents
  }

  snapshot(): UIState {
    return {
      ...this.state,
      archive: this.state.archive.slice(0, ARCHIVE_IN_SNAPSHOT),
      runtime: this.runtime,
      commandBar: this.commandBar,
      htmlFullscreen: !!this.fullscreenTab,
      fullscreen: this.win.isFullScreen(),
      platform: process.platform,
      peek: this.peek,
      shieldsStatus: this.shields?.getStatus() ?? { ready: false, updating: false },
      activeShieldsOn: !!this.shields?.activeFor(this.activeTab()?.url),
      editing: this.editing,
      downloads: this.downloads?.recent() ?? [],
      downloadsUnseen: this.downloadsUnseen,
      library: this.library,
      find: this.find,
      preview: this.preview ? { ...this.preview, rect: this.previewRect() } : null,
      splitView: this.splitViewInfo(),
      splitDragging: this.splitDragging,
      auth: this.authQueue[0] ? { host: this.authQueue[0].host, realm: this.authQueue[0].realm, isProxy: this.authQueue[0].isProxy } : null,
      hoverUrl: this.hoverUrl,
    }
  }

  get settings(): Settings {
    return this.state.settings
  }

  get shieldsSettings(): ShieldsSettings {
    return this.state.shields
  }

  updateSettings(patch: Partial<Settings>) {
    Object.assign(this.state.settings, patch)
    this.onSettingsChanged(this.state.settings)
    this.emit()
  }

  private overlayVisible() {
    return !!this.overlay && (!!this.commandBar || this.peek || !!this.library || this.splitDragging || !!this.preview || this.authQueue.length > 0)
  }

  /** Keep floating things above the pages, in order: find bar, overlay, Peek card. */
  private raiseFloating() {
    if (this.find && this.findView) this.win.contentView.addChildView(this.findView)
    if (this.overlayVisible()) this.win.contentView.addChildView(this.overlay!)
    if (this.preview && this.previewView) this.win.contentView.addChildView(this.previewView)
  }

  /**
   * Schedule a UI refresh. Many events (loading, titles, audio) arrive in
   * bursts, so updates are batched to at most one every EMIT_INTERVAL_MS.
   * `persist: false` is for runtime-only changes that need no disk write.
   */
  private emit(persist = true) {
    if (persist) saveState(this.state)
    if (this.emitTimer) return
    const wait = Math.max(0, this.lastEmit + EMIT_INTERVAL_MS - Date.now())
    this.emitTimer = setTimeout(() => this.emitNow(), wait)
  }

  private emitNow() {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
    this.lastEmit = Date.now()
    if (this.win.isDestroyed()) return
    const snap = this.snapshot()
    this.win.webContents.send(IPC.state, snap)
    // The overlay is refreshed only while it is on screen (and when shown).
    if (this.overlayVisible() && !this.overlay!.webContents.isDestroyed()) this.overlay!.webContents.send(IPC.state, snap)
    if (this.find && this.findView && !this.findView.webContents.isDestroyed()) this.findView.webContents.send(IPC.state, snap)
  }

  // ───────────────────────────── layout ─────────────────────────────

  /** The page area of the window (right of the sidebar, inside the gaps). */
  private contentBox(sidebarVisible = this.state.sidebarVisible) {
    const [width, height] = this.win.getContentSize()
    const { gap } = pageFrame(this.win.isFullScreen())
    const left = sidebarVisible ? SIDEBAR_WIDTH : gap
    return { x: left, y: gap, width: Math.max(0, width - left - gap), height: Math.max(0, height - gap * 2) }
  }

  /** Rectangles for the visible panes: one full box, or two side by side for a split. */
  private paneRects(box = this.contentBox()): Map<string, Electron.Rectangle> {
    const rects = new Map<string, Electron.Rectangle>()
    if (this.attached.length === 2) {
      const split = this.splitOf(this.attached[0])
      const ratio = split?.ratio ?? 0.5
      const leftW = Math.round((box.width - VIEW_GAP) * ratio)
      rects.set(this.attached[0], { ...box, width: leftW })
      rects.set(this.attached[1], { ...box, x: box.x + leftW + VIEW_GAP, width: box.width - leftW - VIEW_GAP })
    } else if (this.attached[0]) {
      rects.set(this.attached[0], box)
    }
    return rects
  }

  private splitViewInfo(): UIState['splitView'] {
    if (this.attached.length !== 2 || this.fullscreenTab) return null
    const split = this.splitOf(this.attached[0])
    if (!split) return null
    const rects = this.paneRects()
    return { id: split.id, ratio: split.ratio, panes: this.attached.map((tabId) => ({ tabId, ...rects.get(tabId)! })) }
  }

  private layout() {
    if (this.win.isDestroyed()) return
    // Anything that needs a fresh layout while the sidebar is sliding ends the slide first.
    if (this.slide) return this.endSlide()
    const [width, height] = this.win.getContentSize()
    const rects = this.paneRects()
    for (const id of this.attached) {
      const view = this.views.get(id)
      if (!view) continue
      if (this.fullscreenTab) {
        // A video went fullscreen: that page fills the window, its split partner hides.
        view.setVisible(id === this.fullscreenTab)
        view.setBounds({ x: 0, y: 0, width, height })
        view.setBorderRadius(0)
        continue
      }
      // Failed loads are shown by the UI underneath, so hide the blank page (single pane only).
      view.setVisible(this.attached.length > 1 || !this.runtime[id]?.error)
      view.setBounds(rects.get(id)!)
      view.setBorderRadius(pageFrame(this.win.isFullScreen()).radius)
    }
    // Command bar, Library, split dragging: whole window. Peek sidebar: just its strip.
    this.overlay?.setBounds(
      this.commandBar || this.library || this.splitDragging || this.preview || this.authQueue.length
        ? { x: 0, y: 0, width, height }
        : { x: 0, y: 0, width: Math.min(width, SIDEBAR_WIDTH + 16), height },
    )
    this.previewView?.setBounds(this.previewRect())
    // Find bar: top-right corner of the page.
    if (this.findView) {
      // Includes transparent padding so the bar's shadow isn't clipped.
      const w = Math.min(400, Math.max(280, width - SIDEBAR_WIDTH - 40))
      this.findView.setBounds({ x: width - VIEW_GAP - w, y: VIEW_GAP + 4, width: w, height: 72 })
    }
  }

  /** Show, hide and place the macOS window buttons (see shared/window-buttons.ts). */
  private applyWindowButtons() {
    if (process.platform !== 'darwin' || this.win.isDestroyed()) return
    const { visible, position } = windowButtons({ sidebarVisible: this.state.sidebarVisible, hoverSidebar: this.peek, fullscreen: this.win.isFullScreen() })
    this.win.setWindowButtonVisibility(visible)
    this.win.setWindowButtonPosition(position)
  }

  /** Show tab `id` (and its split partner) in the content area, or nothing. */
  private attach(id: string | null) {
    const split = id ? this.splitOf(id) : undefined
    const next: string[] = split ? [...split.tabIds] : id ? [id] : []
    // The partner of a split needs a page too.
    for (const tid of next) {
      const tab = this.tab(tid)
      if (tab && !this.views.has(tid)) this.ensureView(tab)
    }
    const ids = next.filter((tid) => this.views.has(tid))
    if (ids.length === this.attached.length && ids.every((x, i) => x === this.attached[i])) return this.layout()
    for (const old of this.attached) {
      const view = this.views.get(old)
      if (view && !ids.includes(old)) this.win.contentView.removeChildView(view)
    }
    this.attached = ids
    for (const tid of ids) this.win.contentView.addChildView(this.views.get(tid)!)
    if (ids.length) this.raiseFloating()
    this.layout()
  }

  /** The split the active tab is in, if any. */
  activeSplitId(): string | undefined {
    return this.state.activeTabId ? this.splitOf(this.state.activeTabId)?.id : undefined
  }

  private splitOf(tabId: string) {
    return this.state.splits.find((s) => s.tabIds.includes(tabId))
  }

  // ───────────────────────────── tab views ─────────────────────────────

  private ensureView(tab: Tab): WebContentsView {
    const existing = this.views.get(tab.id)
    if (existing) return existing
    const view = this.createView(tab)
    const history = this.sleptHistory.get(tab.id)
    this.sleptHistory.delete(tab.id)
    const load = () => view.webContents.loadURL(tab.url).catch(() => {
      /* load errors are shown by the UI; nothing to do here */
    })
    if (history?.entries.length) {
      // Waking from sleep: bring back the whole back/forward history.
      view.webContents.navigationHistory.restore(history).catch(load)
    } else {
      void load()
    }
    return view
  }

  private createView(tab: Tab, adopt?: { webContents?: WebContents; webPreferences?: Electron.WebPreferences }): WebContentsView {
    const partition = this.partitionOf(tab)
    const view = new WebContentsView({
      webPreferences: { ...adopt?.webPreferences, ...pagePreferences(partition) },
      ...(adopt?.webContents ? { webContents: adopt.webContents } : {}),
    })
    view.setBackgroundColor('#ffffff')
    this.views.set(tab.id, view)
    this.runtime[tab.id] = { loaded: true, loading: true, canGoBack: false, canGoForward: false, audible: false, muted: false, blocked: 0 }
    this.wireView(tab.id, view)
    // Registering the first tab makes the extension system "select" it; that
    // must not steal focus from the tab the user is actually on.
    this.registeringTab = true
    try {
      // Like Chrome's incognito, extensions don't run in private browsing.
      if (!isPrivateTab(this.state, tab)) getExtensions(partition).addTab(view.webContents, this.win)
    } finally {
      this.registeringTab = false
    }
    return view
  }

  private wireView(id: string, view: WebContentsView) {
    const wc = view.webContents
    const rt = () => this.runtime[id]
    /** Write to history, unless this is a private tab. */
    const history = (fn: (db: BrowserDB) => void) => {
      if (!isPrivateTab(this.state, this.tab(id))) this.record(fn)
    }
    const update = (patch: Partial<Tab>) => {
      const tab = this.tab(id)
      if (!tab) return
      Object.assign(tab, patch)
      this.emit()
    }
    const syncNav = () => {
      const r = rt()
      if (!r) return
      r.canGoBack = wc.navigationHistory.canGoBack()
      r.canGoForward = wc.navigationHistory.canGoForward()
      update({ url: wc.getURL() })
    }

    wc.on('did-start-loading', () => {
      const r = rt()
      if (r) {
        r.loading = true
        if (r.error) {
          r.error = undefined
          this.layout()
        }
      }
      this.emit(false)
    })
    wc.on('did-start-navigation', (e) => {
      // New page: reset its Shields counter.
      if (e.isMainFrame && !e.isSameDocument && rt() && rt().blocked) {
        rt().blocked = 0
        this.emit(false)
      }
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 = ERR_ABORTED (navigation replaced by another one); not a real failure.
      if (!isMainFrame || code === -3 || !rt()) return
      // We guessed https:// and the site doesn't support it: retry over http.
      const fallback = this.shields?.httpFallback(url, code)
      if (fallback) {
        void wc.loadURL(fallback).catch(() => {})
        return
      }
      rt().error = { code, description, url }
      update({ url, title: displayHost(url), favicon: undefined }) // nothing loaded: no icon to show
      this.layout()
    })
    wc.on('did-stop-loading', () => {
      if (rt()) rt().loading = false
      syncNav()
    })
    // The page's icon. Chromium announces it only when it CHANGES: going from one
    // page to another with the same icon (most pages of a site) announces nothing.
    // So the last one announced stays in force until the next announcement, and a
    // tab waking from sleep keeps its saved icon until its page says otherwise.
    let icon = this.tab(id)?.favicon
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      this.typedIn.delete(id)
      if (rt()) rt().translated = undefined // a new page starts untranslated
      // Pages that aren't websites (blank, page source) announce nothing and have no icon.
      update({ url, favicon: isWebUrl(url) ? icon : undefined })
      if (icon && isWebUrl(url) && httpResponseCode < 400) history((db) => db.setFavicon(url, icon!))
      syncNav()
      if (isWebUrl(url) && httpResponseCode < 400) history((db) => db.addVisit(url, ''))
      lastRecorded = stripHash(url)
    })
    let lastRecorded = ''
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      // Single-page apps (YouTube, Gmail) change pages without reloading: record those too.
      if (!isMainFrame || !isWebUrl(url) || stripHash(url) === lastRecorded) return
      lastRecorded = stripHash(url)
      history((db) => db.addVisit(url, wc.getTitle()))
    })
    wc.on('before-input-event', (_e, input) => {
      // Typing (not shortcuts) means there may be unsaved text: don't sleep this tab.
      if (input.type === 'keyDown' && !input.meta && !input.control && input.key.length === 1) this.typedIn.add(id)
    })
    wc.on('did-navigate-in-page', syncNav)
    wc.on('page-title-updated', (_e, title) => {
      update({ title: title || NEW_TAB_TITLE })
      const url = wc.getURL()
      if (isWebUrl(url)) history((db) => db.setTitle(url, title))
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      icon = favicons[0]
      const url = wc.getURL()
      update({ favicon: isWebUrl(url) ? icon : undefined })
      if (icon && isWebUrl(url)) history((db) => db.setFavicon(url, icon!))
    })
    // Clicking into the other pane of a split makes it the active tab.
    const focusPane = () => {
      if (this.attached.length === 2 && this.attached.includes(id) && this.state.activeTabId !== id) {
        const tab = this.tab(id)
        if (!tab) return
        this.closeFind()
        tab.lastActiveAt = Date.now()
        this.state.activeTabId = id
        this.space().lastTabId = id
        if (!isPrivateTab(this.state, tab)) getExtensions(this.partitionOf(tab)).selectTab(wc)
        this.emit()
      }
    }
    wc.on('focus', focusPane)
    wc.on('before-mouse-event', (_e, mouse) => {
      if (mouse.type === 'mouseDown') focusPane()
    })
    wc.on('dom-ready', () => void this.applyBoosts(wc, true))
    wc.on('will-prevent-unload', (event) => {
      // The page has unsaved changes (a draft, a form). Without this, Electron
      // silently refuses to reload or navigate; ask like Chrome does.
      const choice = dialog.showMessageBoxSync(this.win, {
        type: 'question',
        buttons: ['Leave', 'Stay'],
        defaultId: 1,
        cancelId: 1,
        message: 'Leave site?',
        detail: 'Changes you made may not be saved.',
      })
      if (choice === 0) event.preventDefault()
    })
    wc.on('update-target-url', (_e, target) => {
      if (this.state.activeTabId !== id || this.hoverUrl === target) return
      this.hoverUrl = target
      this.emit(false)
    })
    wc.on('found-in-page', (_e, result) => {
      if (!this.find || this.state.activeTabId !== id) return
      this.find.active = result.activeMatchOrdinal
      this.find.total = result.matches
      this.emit(false)
    })
    wc.on('audio-state-changed', (e) => {
      if (rt()) rt().audible = e.audible
      this.emit(false)
    })
    wc.on('enter-html-full-screen', () => {
      this.fullscreenTab = id
      this.syncEdgeWatch()
      this.layout()
      this.emit(false)
    })
    wc.on('leave-html-full-screen', () => {
      if (this.fullscreenTab === id) this.fullscreenTab = null
      this.syncEdgeWatch()
      this.layout()
      this.emit(false)
    })
    // The site closed this page itself (window.close(), or the page that opened it did).
    // When we destroy a page ourselves (sleep, close), it has left `views` by then.
    wc.once('destroyed', () => {
      if (!this.closing && !this.win.isDestroyed() && this.views.get(id) === view) this.closeTab(id)
    })
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      console.warn(`Tab ${id} crashed (${details.reason}); it will reload when selected again.`)
      const wasActive = this.state.activeTabId === id
      this.unload(id)
      if (wasActive) this.activate(id)
    })

    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      // Popups with explicit size (OAuth / "Sign in with …") stay real popups
      // so window.opener keeps working.
      if (disposition === 'new-window' && features) {
        return {
          action: 'allow',
          createWindow: (options) => this.openPopup(id, options as PopupOptions),
        }
      }
      const opener = this.tab(id)
      // ⇧-click, and new-tab links from pinned tabs / favorites (Arc behavior), open in Peek.
      const fromPinned = opener && opener.kind !== 'today' && this.state.settings.peekFromPinned
      if (disposition === 'new-window' || (fromPinned && (disposition === 'foreground-tab' || disposition === 'background-tab'))) {
        this.openPreview(url, this.partitionOf(opener ?? this.activeTab()!))
        return { action: 'deny' }
      }
      if (disposition === 'background-tab') {
        this.openTab(url, { activate: false, afterTabId: id })
        return { action: 'deny' }
      }
      // Foreground tab: adopt the new WebContents so window.opener still works.
      return {
        action: 'allow',
        createWindow: (options) => {
          const tab = this.insertTab(url, { afterTabId: id })
          const child = this.createView(tab, {
            webContents: (options as { webContents?: WebContents }).webContents,
            webPreferences: options.webPreferences,
          })
          this.activate(tab.id)
          return child.webContents
        },
      }
    })

    attachWebContextMenu(this, wc)
  }

  /**
   * Destroy a tab's page but keep it in the sidebar. With `keepHistory`, the
   * back/forward list is remembered so waking the tab restores it.
   */
  private unload(id: string, keepHistory = false) {
    const view = this.views.get(id)
    if (!view) return
    // Gone already when the site closed the page itself.
    const wc = view.webContents as WebContents | undefined
    const alive = !!wc && !wc.isDestroyed()
    if (keepHistory && alive) {
      this.sleptHistory.set(id, { entries: wc.navigationHistory.getAllEntries(), index: wc.navigationHistory.getActiveIndex() })
    } else {
      this.sleptHistory.delete(id)
    }
    if (this.attached.includes(id) && !this.win.isDestroyed()) {
      const view = this.views.get(id)
      if (view) this.win.contentView.removeChildView(view)
      this.attached = this.attached.filter((x) => x !== id)
      this.layout()
    }
    this.views.delete(id)
    this.typedIn.delete(id)
    if (alive) this.boostCss.delete(wc.id)
    delete this.runtime[id]
    if (alive) wc.close()
  }

  /** Put a background tab to sleep: frees its memory and CPU; it reloads when selected. */
  sleepTab(id: string) {
    if (id === this.state.activeTabId || this.attached.includes(id) || !this.views.has(id)) return
    this.unload(id, true)
    this.emit(false)
  }

  private sleepIdleTabs() {
    this.autoArchive()
    const minutes = this.state.settings.sleepAfterMinutes
    if (!minutes) return
    const cutoff = Date.now() - minutes * 60_000
    for (const [id, view] of this.views) {
      const tab = this.tab(id)
      const rt = this.runtime[id]
      if (!tab || id === this.state.activeTabId || this.attached.includes(id) || tab.lastActiveAt > cutoff) continue
      // Keep tabs that are playing sound (music, calls) or have typed text.
      if (rt?.audible || this.typedIn.has(id) || view.webContents.isCurrentlyAudible()) continue
      this.unload(id, true)
    }
    this.sleepOverBudget()
    this.emit(false)
  }

  /**
   * Memory guard: with more than MAX_LOADED_TABS pages loaded, put the least
   * recently used ones to sleep even if they haven't been idle for the full timer.
   */
  private sleepOverBudget() {
    const excess = this.views.size - MAX_LOADED_TABS
    if (excess <= 0) return
    const recent = Date.now() - 2 * 60_000
    const candidates = [...this.views.entries()]
      .map(([id, view]) => ({ id, view, tab: this.tab(id) }))
      .filter(
        ({ id, view, tab }) =>
          tab &&
          !this.attached.includes(id) &&
          tab.lastActiveAt < recent &&
          !this.runtime[id]?.audible &&
          !this.typedIn.has(id) &&
          !view.webContents.isCurrentlyAudible(),
      )
      .sort((a, b) => a.tab!.lastActiveAt - b.tab!.lastActiveAt)
    for (const { id } of candidates.slice(0, excess)) this.unload(id, true)
  }

  // ───────────────────────────── tab operations ─────────────────────────────

  /** Create a tab in the active space (top of Today, or right after its opener). */
  private insertTab(url: string, opts: OpenOptions = {}): Tab {
    const now = Date.now()
    const tab: Tab = { id: randomUUID(), spaceId: this.state.activeSpaceId, url, title: url, kind: 'today', createdAt: now, lastActiveAt: now }
    const opener = opts.afterTabId ? locate(this.state, opts.afterTabId) : null
    if (opener && (opener.ref.type === 'today' || (opener.ref.type === 'folder' && kindFor(this.state, opener.ref) === 'today'))) {
      addTab(this.state, tab, opener.spaceId, opener.ref, opener.index + 1)
    } else {
      // Arc puts new tabs at the top of Today.
      addTab(this.state, tab, this.state.activeSpaceId, { type: 'today' }, 0)
    }
    this.emit()
    return tab
  }

  openTab(url: string, opts: OpenOptions = {}): Tab {
    const tab = this.insertTab(url, opts)
    if (opts.activate === false) this.ensureView(tab)
    else this.activate(tab.id)
    return tab
  }

  activate(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    if (id !== this.state.activeTabId) this.closeFind()
    this.closePreview()
    this.hoverUrl = ''
    // Selecting a tab from another space (command bar, archive, extension) switches to it.
    const space = this.space()
    const tabSpace = spaceById(this.state, tab.spaceId)
    const visibleHere = tab.kind === 'favorite' ? tabSpace?.partition === space.partition : tab.spaceId === space.id
    if (!visibleHere && tabSpace) this.state.activeSpaceId = tabSpace.id
    // The tab we are leaving starts its idle clock now.
    const prev = this.activeTab()
    if (prev && prev.id !== id) prev.lastActiveAt = Date.now()
    tab.lastActiveAt = Date.now()
    this.state.activeTabId = id
    this.space().lastTabId = id
    const view = this.ensureView(tab)
    this.attach(id)
    this.autoPip(prev, id)
    if (!this.commandBar) view.webContents.focus()
    if (!isPrivateTab(this.state, tab)) getExtensions(this.partitionOf(tab)).selectTab(view.webContents)
    this.emit()
  }

  /** Arc behavior: ⌘W on a pinned tab or favorite unloads it and resets it to its pinned URL. */
  closeTab(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    const split = this.splitOf(id)
    if (split) this.exitSplit(split.id, split.tabIds.find((t) => t !== id))
    if (tab.kind !== 'today') {
      if (!this.views.has(id)) return
      this.selectNeighbor(id)
      this.unload(id)
      if (tab.pinnedUrl) tab.url = tab.pinnedUrl
      this.emit()
      return
    }
    this.removeTab(id)
  }

  private rememberClosed(tab: Tab, loc: Location | null) {
    // Private tabs leave no trace: they can't be reopened with ⇧⌘T.
    if (spaceById(this.state, loc?.spaceId || tab.spaceId)?.private) return
    this.closed.unshift({
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      spaceId: loc?.spaceId || tab.spaceId,
      kind: tab.kind,
      list: loc?.ref ?? { type: 'today' },
      index: loc?.index ?? 0,
      pinnedUrl: tab.pinnedUrl,
    })
    this.closed.length = Math.min(this.closed.length, MAX_CLOSED)
  }

  /** Remove a tab entirely (also used for pinned tabs and favorites from the context menu). */
  removeTab(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    if (this.state.activeTabId === id) this.selectNeighbor(id)
    this.unload(id)
    const loc = removeTab(this.state, id)
    this.rememberClosed(tab, loc)
    this.emit()
  }

  private selectNeighbor(id: string) {
    if (this.state.activeTabId !== id) return
    const ordered = sidebarOrder(this.state, this.state.activeSpaceId)
    const i = ordered.indexOf(id)
    // Prefer the tab below, then above.
    const next = ordered[i + 1] ?? ordered[i - 1]
    if (next && next !== id) this.activate(next)
    else {
      this.state.activeTabId = null
      this.space().lastTabId = null
      this.attach(null)
    }
  }

  reopenClosed() {
    const c = this.closed.shift()
    if (!c) return
    const now = Date.now()
    const tab: Tab = {
      id: randomUUID(),
      spaceId: c.spaceId,
      url: c.url,
      title: c.title,
      favicon: c.favicon,
      kind: c.kind,
      pinnedUrl: c.pinnedUrl,
      createdAt: now,
      lastActiveAt: now,
    }
    // Back where it was if that place still exists, else top of Today.
    const spaceId = spaceById(this.state, c.spaceId) ? c.spaceId : this.state.activeSpaceId
    const ref = listArray(this.state, spaceId, c.list) ? c.list : { type: 'today' as const }
    addTab(this.state, tab, spaceId, ref, c.list === ref ? c.index : 0)
    this.activate(tab.id)
  }

  /** Move a tab/folder (drag and drop). Lists are those of the active space. */
  moveItem(id: string, to: ListRef, index: number) {
    if (moveItem(this.state, id, this.state.activeSpaceId, to, index)) this.emit()
  }

  togglePin(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    const space = this.space()
    if (tab.kind === 'today') moveItem(this.state, id, space.id, { type: 'pinned' }, space.pinned.length)
    else moveItem(this.state, id, space.id, { type: 'today' }, 0)
    this.emit()
  }

  toggleFavorite(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    const space = this.space()
    if (tab.kind === 'favorite') moveItem(this.state, id, space.id, { type: 'today' }, 0)
    else moveItem(this.state, id, space.id, { type: 'favorites' }, favoritesOf(this.state, space.partition).length)
    this.emit()
  }

  /** Arc's "Clear": archive every Today tab in the current space. */
  clearToday() {
    const removed = clearToday(this.state, this.state.activeSpaceId, Date.now())
    this.afterRemoving(removed)
  }

  /** Tabs were removed from the model: drop their pages and pick a new active tab if needed. */
  private afterRemoving(ids: string[]) {
    if (!ids.length) return
    const activeGone = !!this.state.activeTabId && ids.includes(this.state.activeTabId)
    for (const id of ids) {
      this.unload(id)
      this.sleptHistory.delete(id)
    }
    if (activeGone) {
      this.state.activeTabId = null
      this.space().lastTabId = null
      const first = sidebarOrder(this.state, this.state.activeSpaceId)[0]
      if (first) this.activate(first)
      else this.attach(null)
    }
    this.emit()
  }

  /** Tidy: close duplicates and group Today tabs by site (no AI). */
  tidy() {
    const result = tidy(this.state, this.state.activeSpaceId, this.state.activeTabId, () => randomUUID())
    for (const { tab, loc } of result.closed) this.rememberClosed(tab, loc)
    this.afterRemoving(result.closed.map((c) => c.tab.id))
    this.emit()
  }

  /** Archive Today tabs that haven't been used for a while (Arc's auto-archive). */
  private autoArchive() {
    const hours = this.state.settings.archiveAfterHours
    if (!hours) return
    const stale = staleTodayTabs(this.state, Date.now() - hours * 3_600_000).filter((id) => {
      const rt = this.runtime[id]
      return id !== this.state.activeTabId && !this.attached.includes(id) && !rt?.audible && !this.typedIn.has(id)
    })
    const now = Date.now()
    for (const id of stale) archiveTab(this.state, id, now)
    this.afterRemoving(stale)
  }

  restoreArchived(index: number) {
    const item = this.state.archive[index]
    if (!item) return
    this.state.archive.splice(index, 1)
    if (spaceById(this.state, item.spaceId)) this.state.activeSpaceId = item.spaceId
    this.openTab(item.url)
  }

  selectByIndex(n: number) {
    const ordered = sidebarOrder(this.state, this.state.activeSpaceId, false)
    const id = n === 9 ? ordered[ordered.length - 1] : ordered[n - 1]
    if (id) this.activate(id)
  }

  cycle(delta: 1 | -1) {
    const ordered = sidebarOrder(this.state, this.state.activeSpaceId, false)
    if (!ordered.length) return
    const i = ordered.indexOf(this.state.activeTabId ?? '')
    const next = ordered[(i + delta + ordered.length) % ordered.length]
    this.activate(next)
  }

  navigate(input: string, mode: 'new' | 'edit') {
    const url = resolveInput(input, this.state.searchEngine)
    if (!url) return
    // "example.com" was typed without a scheme: https is our guess, fall back to http if needed.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) && url.startsWith('https://')) this.shields?.markUpgraded(url)
    const active = this.activeTab()
    if (mode === 'edit' && active) {
      const loaded = this.views.get(active.id)
      active.url = url
      if (loaded) void loaded.webContents.loadURL(url).catch(() => {})
      const view = this.ensureView(active) // loads `url` if the tab was asleep
      this.attach(active.id)
      view.webContents.focus()
      this.emit()
    } else {
      const splitWith = this.pendingSplitWith
      this.pendingSplitWith = null
      const tab = this.openTab(url)
      if (splitWith && this.tab(splitWith)) this.createSplit(tab.id, splitWith)
    }
  }

  // ───────────────────────────── spaces ─────────────────────────────

  switchSpace(id: string) {
    const space = spaceById(this.state, id)
    if (!space || (id === this.state.activeSpaceId && this.attached.length)) return
    const prev = this.activeTab()
    if (prev) prev.lastActiveAt = Date.now()
    this.state.activeSpaceId = id
    const order = sidebarOrder(this.state, id)
    const target = space.lastTabId && order.includes(space.lastTabId) ? space.lastTabId : null
    if (target) {
      this.activate(target)
    } else {
      // Empty space (or nothing selected yet): show its empty state.
      this.state.activeTabId = null
      this.attach(null)
      this.emit()
    }
  }

  cycleSpace(delta: 1 | -1) {
    const spaces = this.state.spaces
    const i = spaces.findIndex((s) => s.id === this.state.activeSpaceId)
    this.switchSpace(spaces[(i + delta + spaces.length) % spaces.length].id)
  }

  selectSpaceByIndex(n: number) {
    const space = this.state.spaces[n - 1]
    if (space) this.switchSpace(space.id)
  }

  /** New space. With `separateProfile`, it gets its own cookies, logins and extensions. */
  async createSpace(separateProfile: boolean) {
    const id = randomUUID()
    const partition = separateProfile ? `persist:space-${id}` : this.space().partition
    if (separateProfile) await this.prepareSession(partition)
    const used = new Set(this.state.spaces.map((s) => s.color))
    const color = SPACE_COLORS.find((c) => !used.has(c.value))?.value ?? SPACE_COLORS[this.state.spaces.length % SPACE_COLORS.length].value
    this.state.spaces.push({ id, name: separateProfile ? 'New Profile' : 'New Space', color, partition, pinned: [], today: [], lastTabId: null })
    this.editing = { type: 'space', id }
    this.switchSpace(id)
    this.emit()
  }

  /** Space color and optional gradient color (Settings → Appearance). */
  updateSpaceTheme(id: string, color?: string, gradient?: string | null) {
    const space = spaceById(this.state, id)
    if (!space) return
    const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
    if (hex(color)) space.color = color!.toLowerCase()
    if (gradient === null) delete space.gradient
    else if (hex(gradient)) space.gradient = gradient!.toLowerCase()
    this.emit()
  }

  renameSpace(id: string, name: string) {
    const space = spaceById(this.state, id)
    if (space && name.trim()) space.name = name.trim().slice(0, 40)
    if (this.editing?.id === id) this.editing = null
    this.emit()
  }

  deleteSpace(id: string) {
    const space = spaceById(this.state, id)
    if (!space) return
    // There must always be one normal space left.
    if (!space.private && this.state.spaces.filter((s) => !s.private).length < 2) return
    const doomed = sidebarOrder(this.state, id).filter((tabId) => this.tab(tabId)?.kind !== 'favorite')
    for (const folderId of [...space.pinned, ...space.today]) removeFolder(this.state, folderId, true)
    for (const tabId of doomed) {
      this.unload(tabId)
      removeTab(this.state, tabId)
    }
    this.state.spaces = this.state.spaces.filter((s) => s.id !== id)
    // Favorites of this profile now belong to another space using it, or go away.
    const heir = this.state.spaces.find((s) => s.partition === space.partition)
    for (const favId of [...(this.state.favorites[space.partition] ?? [])]) {
      const fav = this.tab(favId)
      if (!fav || fav.spaceId !== id) continue
      if (heir) fav.spaceId = heir.id
      else {
        this.unload(favId)
        removeTab(this.state, favId)
      }
    }
    if (!heir) delete this.state.favorites[space.partition]
    if (this.state.activeSpaceId === id) this.switchSpace(this.state.spaces[0].id)
    if (space.private) {
      // Wipe the in-memory session now rather than at quit: cookies, cache, storage.
      const ses = session.fromPartition(space.partition)
      void ses.clearStorageData().catch(() => {})
      void ses.clearCache().catch(() => {})
      forgetPartitionPermissions(space.partition)
    }
    this.emit()
  }

  /** Switch to a normal space if a private one is showing (links from other apps open there). */
  leavePrivate() {
    if (this.space().private) this.switchSpace(this.state.spaces[0].id)
  }

  /** ⇧⌘N: go to the private space, creating it (with a fresh in-memory session) if needed. */
  async openPrivate() {
    let space = this.state.spaces.find((s) => s.private)
    if (!space) {
      const id = randomUUID()
      const partition = `private-${id}` // no "persist:" prefix = kept in memory only
      await this.prepareSession(partition, { private: true })
      space = { id, name: 'Private', color: '#6b7280', partition, pinned: [], today: [], lastTabId: null, private: true }
      this.state.spaces.push(space)
    }
    this.switchSpace(space.id)
    if (!this.state.activeTabId) this.openCommandBar('new')
    this.emit()
  }

  showSpaceMenu(id: string) {
    const space = spaceById(this.state, id)
    if (!space) return
    if (space.private) {
      Menu.buildFromTemplate([
        { label: 'History and cookies in this space aren’t saved', enabled: false },
        { type: 'separator' },
        { label: 'Close Private Space', click: () => this.deleteSpace(id) },
      ]).popup({ window: this.win })
      return
    }
    const others = this.state.spaces.filter((s) => s.partition === space.partition).length - 1
    const ownProfile = space.partition !== this.state.spaces[0].partition
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: 'Rename Space', click: () => ((this.editing = { type: 'space', id }), this.emit(false)) },
      { label: 'Theme…', click: () => this.openLibrary('settings') },
      {
        label: 'Color',
        submenu: SPACE_COLORS.map((c) => ({
          label: c.name,
          type: 'radio' as const,
          checked: space.color === c.value,
          click: () => {
            space.color = c.value
            this.emit()
          },
        })),
      },
      { type: 'separator' },
      {
        label: ownProfile ? (others ? `Separate profile (shared with ${others} other space${others > 1 ? 's' : ''})` : 'Separate profile (own logins)') : 'Main profile',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Delete Space…',
        enabled: this.state.spaces.length > 1,
        click: async () => {
          const { response } = await dialog.showMessageBox(this.win, {
            type: 'warning',
            buttons: ['Delete Space', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `Delete “${space.name}”?`,
            detail: 'Its pinned and Today tabs will be closed. This cannot be undone.',
          })
          if (response === 0) this.deleteSpace(id)
        },
      },
    ]
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  showAddSpaceMenu() {
    Menu.buildFromTemplate([
      { label: 'New Space', click: () => void this.createSpace(false) },
      { label: 'New Space with Separate Profile', sublabel: 'Own cookies, logins and extensions', click: () => void this.createSpace(true) },
      { type: 'separator' },
      { label: 'Private Browsing', accelerator: 'Shift+CmdOrCtrl+N', registerAccelerator: false, click: () => void this.openPrivate() },
    ]).popup({ window: this.win })
  }

  // ───────────────────────────── folders ─────────────────────────────

  newFolder(list: 'pinned' | 'today', withTab?: string) {
    const id = randomUUID()
    const space = this.space()
    createFolder(this.state, space.id, { type: list }, 0, 'New Folder', id, withTab ? [withTab] : [])
    this.editing = { type: 'folder', id }
    this.emit()
  }

  toggleFolder(id: string) {
    const folder = folderById(this.state, id)
    if (!folder) return
    folder.collapsed = !folder.collapsed
    this.emit()
  }

  renameFolder(id: string, name: string) {
    const folder = folderById(this.state, id)
    if (folder && name.trim()) {
      folder.name = name.trim().slice(0, 60)
      folder.auto = undefined // renamed by you: Tidy keeps it
    }
    if (this.editing?.id === id) this.editing = null
    this.emit()
  }

  showFolderMenu(id: string) {
    const folder = folderById(this.state, id)
    if (!folder) return
    Menu.buildFromTemplate([
      { label: 'Rename Folder', click: () => ((this.editing = { type: 'folder', id }), this.emit(false)) },
      { label: folder.collapsed ? 'Expand' : 'Collapse', click: () => this.toggleFolder(id) },
      { type: 'separator' },
      {
        label: 'Ungroup',
        click: () => {
          removeFolder(this.state, id, true)
          this.emit()
        },
      },
      {
        label: `Close Folder and ${folder.children.length} Tab${folder.children.length === 1 ? '' : 's'}`,
        click: () => {
          for (const tabId of folder.children) {
            const tab = this.tab(tabId)
            if (tab) this.rememberClosed(tab, locate(this.state, tabId))
          }
          this.afterRemoving(removeFolder(this.state, id, false))
        },
      },
    ]).popup({ window: this.win })
  }

  /**
   * Show or hide the sidebar, with the page sliding aside to uncover it or back
   * over it. The sidebar itself doesn't move: it sits underneath the page.
   *
   * Only the page's position changes during the slide. Its size changes once
   * (before a hide, after a show), because every change of size makes the page
   * lay itself out again, and doing that for each frame is what makes such an
   * animation stutter on a slow machine.
   */
  toggleSidebar() {
    if (this.slide) this.endSlide()
    const show = !this.state.sidebarVisible
    if (this.peek) this.setPeek(false)
    const panes = this.fullscreenTab ? [] : this.attached.flatMap((id) => (this.views.has(id) ? [{ id, view: this.views.get(id)! }] : []))
    const animate = panes.length > 0 && this.win.isVisible() && !systemPreferences.getAnimationSettings().prefersReducedMotion
    if (!animate) return this.setSidebarVisible(show)

    const shift = this.contentBox(show).x - this.contentBox(!show).x
    if (show) {
      // Uncover: the sidebar is drawn now, the page moves off it, and takes its narrower size at the end.
      this.state.sidebarVisible = true
      this.applyWindowButtons()
      this.emitNow()
    } else {
      // Cover: the page takes its wider size first (running off the right edge for a moment), then moves over.
      const wide = this.paneRects(this.contentBox(false))
      for (const { id, view } of panes) view.setBounds({ ...wide.get(id)!, x: wide.get(id)!.x - shift })
    }
    const views = panes.map((p) => p.view)
    const from = views.map((view) => view.getBounds())
    const started = Date.now()
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / SIDEBAR_SLIDE_MS)
      const eased = 1 - (1 - t) ** 3
      views.forEach((view, i) => !view.webContents.isDestroyed() && view.setBounds({ ...from[i], x: Math.round(from[i].x + shift * eased) }))
      if (t >= 1) this.endSlide()
    }, 1000 / 60)
    this.slide = { timer, show }
  }

  /** The window is going away: pages being destroyed now are not tabs being closed. */
  private closing = false

  /** A sidebar slide in progress, and where it is heading. */
  private slide: { timer: NodeJS.Timeout; show: boolean } | null = null

  /** Finish the slide at once: final state, final layout. */
  private endSlide() {
    const slide = this.slide
    if (!slide) return
    clearInterval(slide.timer)
    this.slide = null
    this.setSidebarVisible(slide.show)
  }

  private setSidebarVisible(visible: boolean) {
    this.state.sidebarVisible = visible
    this.syncEdgeWatch()
    this.applyWindowButtons()
    this.layout()
    this.emitNow()
  }

  /**
   * The pointer left the hover sidebar, as far as its page can tell. But the top
   * strip of the sidebar (the window buttons and the area you drag the window by)
   * belongs to macOS, not the page: moving onto it looks exactly like leaving.
   * So check where the pointer really is, and while it is on that strip keep the
   * sidebar open and watch until it moves on.
   */
  private peekLeft() {
    if (!this.peek || this.peekWatch) return
    if (this.pointerOverPeek() !== 'top') return this.setPeek(false)
    this.peekWatch = setInterval(() => {
      const where = this.peek ? this.pointerOverPeek() : 'outside'
      if (where === 'top') return
      this.stopPeekWatch()
      // Back over the sidebar's own content: its page reports the next leave itself.
      if (where === 'outside') this.setPeek(false)
    }, 150)
  }

  private peekWatch: NodeJS.Timeout | null = null

  /**
   * In a normal window the hidden sidebar is brought back by a strip of the
   * frame at the left edge, which notices the pointer. In full screen there is
   * no frame: the page reaches the edge of the display. So while the sidebar is
   * hidden in full screen, watch for the pointer reaching the left edge instead.
   */
  private syncEdgeWatch() {
    // Not while a video fills the screen: nothing should slide in over it, and the
    // browser should be doing as little as possible then.
    const wanted = !this.win.isDestroyed() && this.win.isFullScreen() && !this.state.sidebarVisible && !this.fullscreenTab
    if (wanted === !!this.edgeWatch) return
    if (this.edgeWatch) clearInterval(this.edgeWatch)
    this.edgeWatch = wanted
      ? setInterval(() => {
          if (this.peek || this.win.isDestroyed() || !this.win.isFocused()) return
          const point = screen.getCursorScreenPoint()
          const bounds = this.win.getContentBounds()
          const insideHeight = point.y >= bounds.y && point.y <= bounds.y + bounds.height
          if (insideHeight && point.x <= bounds.x + 1) this.setPeek(true)
        }, 150)
      : null
  }

  private edgeWatch: NodeJS.Timeout | null = null

  private stopPeekWatch() {
    if (this.peekWatch) clearInterval(this.peekWatch)
    this.peekWatch = null
  }

  private pointerOverPeek(): 'top' | 'body' | 'outside' {
    if (this.win.isDestroyed()) return 'outside'
    const point = screen.getCursorScreenPoint()
    const bounds = this.win.getContentBounds()
    const x = point.x - bounds.x
    const y = point.y - bounds.y
    if (x < 0 || y < 0 || x > SIDEBAR_WIDTH || y > bounds.height) return 'outside'
    return y <= SIDEBAR_TOP_HEIGHT ? 'top' : 'body'
  }

  /** Arc-style: hovering the left edge shows the hidden sidebar over the page. */
  setPeek(open: boolean) {
    if (open && (this.state.sidebarVisible || this.fullscreenTab || this.commandBar || this.library)) return
    if (this.peek === open) return
    this.stopPeekWatch()
    this.peek = open
    const overlay = this.ensureOverlay()
    if (open) this.win.contentView.addChildView(overlay)
    else if (!this.commandBar && !this.library) this.win.contentView.removeChildView(overlay)
    this.applyWindowButtons()
    this.layout()
    this.emitNow()
  }

  private ensureOverlay(): WebContentsView {
    if (this.overlay) return this.overlay
    const overlay = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    overlay.setBackgroundColor('#00000000')
    void overlay.webContents.loadURL(`${this.rendererUrl}#overlay`)
    overlay.webContents.on('did-finish-load', () => this.emitNow())
    this.overlay = overlay
    return overlay
  }

  copyUrl() {
    const tab = this.activeTab()
    if (tab) clipboard.writeText(tab.url)
  }

  // ───────────────────────────── command bar ─────────────────────────────

  openCommandBar(mode: 'new' | 'edit') {
    const active = this.activeTab()
    if (mode === 'edit' && !active) mode = 'new'
    this.closePreview()
    this.peek = false
    this.library = null
    this.commandBar = { mode, initialInput: mode === 'edit' && active ? active.url : '' }
    const overlay = this.ensureOverlay()
    this.win.contentView.addChildView(overlay)
    this.applyWindowButtons()
    this.layout()
    overlay.webContents.focus()
    this.emitNow()
  }

  closeCommandBar(keepPendingSplit = false) {
    if (!this.commandBar) return
    this.commandBar = null
    if (!keepPendingSplit) this.pendingSplitWith = null
    if (this.overlay && !this.library) this.win.contentView.removeChildView(this.overlay)
    this.layout()
    this.activeWebContents()?.focus()
    this.emitNow()
  }

  // ───────────────────────────── sidebar tab menu ─────────────────────────────

  showTabMenu(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    const loaded = this.views.has(id)
    const rt = this.runtime[id]
    const space = this.space()
    // Tabs don't move into or out of private browsing.
    const otherSpaces = isPrivateTab(this.state, tab) ? [] : this.state.spaces.filter((s) => s.id !== tab.spaceId && !s.private)
    const loc = locate(this.state, id)
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: tab.kind === 'favorite' ? 'Remove from Favorites' : 'Add to Favorites', click: () => this.toggleFavorite(id) },
      ...(tab.kind !== 'favorite' ? [{ label: tab.kind === 'pinned' ? 'Unpin Tab' : 'Pin Tab', click: () => this.togglePin(id) }] : []),
      ...(tab.kind !== 'favorite'
        ? [
            {
              label: 'Add to New Folder',
              click: () => this.newFolder(tab.kind === 'pinned' ? 'pinned' : 'today', id),
            },
          ]
        : []),
      ...(loc?.ref.type === 'folder'
        ? [{ label: 'Remove from Folder', click: () => this.moveItem(id, { type: tab.kind === 'pinned' ? 'pinned' : 'today' }, 0) }]
        : []),
      ...(tab.kind !== 'favorite' && otherSpaces.length
        ? [
            {
              label: 'Move to Space',
              submenu: otherSpaces.map((target) => ({
                label: target.name + (target.partition !== space.partition ? ' (other profile)' : ''),
                click: () => {
                  // A page can't change profile while loaded: reload it in the new one.
                  if (target.partition !== this.partitionOf(tab)) this.unload(id)
                  moveItem(this.state, id, target.id, { type: tab.kind === 'pinned' ? 'pinned' : 'today' }, 0)
                  if (this.state.activeTabId === id) this.switchSpace(target.id)
                  this.emit()
                },
              })),
            },
          ]
        : []),
      { type: 'separator' },
      ...(this.splitOf(id)
        ? [
            { label: 'Swap Split Sides', click: () => this.swapSplit(this.splitOf(id)!.id) },
            { label: 'Exit Split View', click: () => this.exitSplit(this.splitOf(id)!.id, id) },
          ]
        : this.state.activeTabId && this.state.activeTabId !== id
          ? [{ label: 'Open in Split View', click: () => this.createSplit(id) }]
          : []),
      { label: 'Copy Link', click: () => clipboard.writeText(tab.url) },
      { label: 'Duplicate Tab', click: () => this.openTab(tab.url, { afterTabId: id }) },
      { type: 'separator' },
      { label: 'Reload', enabled: loaded, click: () => this.views.get(id)?.webContents.reload() },
      {
        label: rt?.muted ? 'Unmute Tab' : 'Mute Tab',
        enabled: loaded,
        click: () => {
          const wc = this.views.get(id)?.webContents
          if (!wc || !rt) return
          rt.muted = !rt.muted
          wc.setAudioMuted(rt.muted)
          this.emit(false)
        },
      },
      { label: 'Open in Default Browser', click: () => void electronShell.openExternal(tab.url) },
      { type: 'separator' },
      {
        label: 'Put Tab to Sleep',
        enabled: loaded && id !== this.state.activeTabId,
        click: () => this.sleepTab(id),
      },
    ]
    if (tab.kind !== 'today') {
      items.push(
        { label: 'Unload Tab', enabled: loaded, click: () => this.closeTab(id) },
        {
          label: 'Reset to Pinned URL',
          enabled: !!tab.pinnedUrl && tab.url !== tab.pinnedUrl,
          click: () => {
            tab.url = tab.pinnedUrl!
            this.views.get(id)?.webContents.loadURL(tab.url).catch(() => {})
            this.emit()
          },
        },
        {
          label: 'Set Pinned URL to Current Page',
          enabled: !!tab.pinnedUrl && tab.url !== tab.pinnedUrl,
          click: () => {
            tab.pinnedUrl = tab.url
            this.emit()
          },
        },
        { type: 'separator' },
        { label: tab.kind === 'favorite' ? 'Delete Favorite' : 'Delete Pinned Tab', click: () => this.removeTab(id) },
      )
    } else {
      items.push({ label: 'Close Tab', click: () => this.removeTab(id) })
    }
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  // ───────────────────────────── Shields ─────────────────────────────

  updateShields(patch: Partial<ShieldsSettings>, reloadActive = false) {
    const prev = { ...this.state.shields }
    Object.assign(this.state.shields, patch)
    void this.shields?.settingsChanged(prev, this.state.shields)
    this.emit()
    if (reloadActive) this.activeWebContents()?.reload()
  }

  showShieldsMenu() {
    const tab = this.activeTab()
    const s = this.state.shields
    const status = this.shields?.getStatus()
    const site = tab ? Shields.siteOf(tab.url) : null
    const siteOn = !!site && !s.disabledSites.includes(site)
    const blocked = tab ? (this.runtime[tab.id]?.blocked ?? 0) : 0
    const isPrivate = isPrivateTab(this.state, tab)

    const updated = status?.updatedAt ? `Filter lists updated ${timeAgo(status.updatedAt)}` : 'Filter lists not downloaded yet'
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: s.enabled && siteOn ? `${blocked} blocked on this page` : 'Shields are off for this page', enabled: false },
      { type: 'separator' },
      {
        // Per-site choices are saved to settings, so they aren't offered in private browsing.
        label: isPrivate ? 'Shields on (per-site switch is off in private browsing)' : site ? `Shields on for ${site}` : 'Shields on for this site',
        type: 'checkbox',
        checked: siteOn,
        enabled: !!site && s.enabled && !isPrivate,
        click: () => {
          if (!site) return
          const disabledSites = siteOn ? [...s.disabledSites, site] : s.disabledSites.filter((d) => d !== site)
          this.updateShields({ disabledSites }, true)
        },
      },
      { type: 'separator' },
      {
        label: 'Block Cookie Banners',
        type: 'checkbox',
        checked: s.blockCookieBanners,
        enabled: s.enabled,
        click: (item) => this.updateShields({ blockCookieBanners: item.checked }),
      },
      {
        label: 'Upgrade Connections to HTTPS',
        type: 'checkbox',
        checked: s.upgradeHttps,
        click: (item) => this.updateShields({ upgradeHttps: item.checked }),
      },
      {
        label: 'Remove Tracking Parameters from Links',
        type: 'checkbox',
        checked: s.stripTrackingParams,
        click: (item) => this.updateShields({ stripTrackingParams: item.checked }),
      },
      { type: 'separator' },
      {
        label: 'Block Ads and Trackers Everywhere',
        type: 'checkbox',
        checked: s.enabled,
        click: (item) => this.updateShields({ enabled: item.checked }, true),
      },
      { type: 'separator' },
      { label: status?.updating ? 'Updating filter lists…' : status?.error ? `Update failed: ${status.error}` : updated, enabled: false },
      { label: 'Update Filter Lists Now', enabled: !status?.updating, click: () => void this.shields?.refresh() },
    ]
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  // ───────────────────────────── site sign-in (HTTP auth) ─────────────────────────────

  private hoverUrl = ''
  private authQueue: { host: string; realm: string; isProxy: boolean; callback: (username?: string, password?: string) => void }[] = []

  /** A server or proxy wants a username and password: ask in the overlay. */
  requestAuth(info: { host: string; realm: string; isProxy: boolean }, callback: (username?: string, password?: string) => void) {
    this.authQueue.push({ ...info, callback })
    if (this.authQueue.length > 1) return // shown when the current one is answered
    this.closeFind()
    const overlay = this.ensureOverlay()
    this.raiseFloating()
    this.layout()
    overlay.webContents.focus()
    this.emitNow()
  }

  private answerAuth(username?: string, password?: string) {
    const req = this.authQueue.shift()
    if (!req) return
    req.callback(username, password)
    if (!this.authQueue.length) {
      if (this.overlay && !this.overlayVisible()) this.win.contentView.removeChildView(this.overlay)
      this.layout()
      this.activeWebContents()?.focus()
    }
    this.emitNow()
  }

  // ───────────────────────────── page tools ─────────────────────────────

  /** Translate the current page in place. Running it again translates content added since. */
  async translateActive() {
    const tab = this.activeTab()
    const wc = this.activeWebContents()
    const rt = tab && this.runtime[tab.id]
    if (!tab || !wc || !rt || rt.translating) return
    const to = this.state.settings.translateTo
    rt.translating = true
    this.emit(false)
    const result = await translatePage(wc, to).catch((err) => ({ ok: false as const, reason: 'failed' as const, detail: String(err) }))
    rt.translating = false
    if (result.ok) {
      rt.translated = languageName(to)
    } else if (result.reason === 'nothing' && rt.translated) {
      // Already translated and nothing new on the page.
    } else if (result.reason === 'same-language') {
      void dialog.showMessageBox(this.win, { type: 'info', message: `This page is already in ${languageName(to)}.` })
    } else if (result.reason === 'nothing') {
      void dialog.showMessageBox(this.win, { type: 'info', message: 'There’s no text to translate on this page.' })
    } else {
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'warning',
        buttons: ['Open in Google Translate', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: 'This page couldn’t be translated here',
        detail: `${result.detail ?? 'The translation service did not respond.'}\n\nGoogle Translate can open a translated copy of the page in a new tab (it doesn’t work for pages you have to be signed in to see).`,
      })
      if (response === 0) this.openTab(googleTranslatePageUrl(tab.url, to), { afterTabId: tab.id })
    }
    this.emit(false)
  }

  async showOriginal() {
    const tab = this.activeTab()
    const wc = this.activeWebContents()
    if (!tab || !wc) return
    await restorePage(wc)
    const rt = this.runtime[tab.id]
    if (rt) rt.translated = undefined
    this.emit(false)
  }

  /** Tab whose video was popped out automatically when you switched away from it. */
  private pipTabId: string | null = null

  /** View → Picture in Picture, and the video right-click menu. */
  togglePip(wc = this.activeWebContents()) {
    if (wc) void pictureInPicture(wc, 'toggle', true)
  }

  /**
   * Like Arc: leaving a tab that is playing video with sound pops the video
   * out; coming back to that tab puts it back.
   */
  private autoPip(prev: Tab | undefined, nextId: string) {
    if (this.pipTabId === nextId) {
      const wc = this.views.get(nextId)?.webContents
      this.pipTabId = null
      if (wc) void pictureInPicture(wc, 'exit')
    }
    if (!prev || prev.id === nextId || !this.state.settings.autoPip) return
    const rt = this.runtime[prev.id]
    const wc = this.views.get(prev.id)?.webContents
    // Still on screen (the other half of a split), silent or muted: leave it be.
    if (!wc || !rt?.audible || rt.muted || this.attached.includes(prev.id)) return
    void pictureInPicture(wc, 'enter').then((result) => {
      if (result === 'ok') this.pipTabId = prev.id
    })
  }

  /** Is this page currently showing a translation? (for the page's right-click menu) */
  isTranslated(wc: WebContents): boolean {
    const id = this.tabIdForWebContents(wc)
    return !!(id && this.runtime[id]?.translated)
  }

  print() {
    this.activeWebContents()?.print({}, () => {})
  }

  viewSource() {
    const tab = this.activeTab()
    if (tab && /^https?:/.test(tab.url)) this.openTab(`view-source:${tab.url}`, { afterTabId: tab.id })
  }

  /** Task Manager: memory and CPU per process, matched to tabs where possible. */
  private tasks(): TaskInfo[] {
    const byPid = new Map<number, { kind: TaskInfo['kind']; title: string; tabId?: string; canSleep?: boolean }>()
    for (const [id, view] of this.views) {
      const tab = this.tab(id)
      byPid.set(view.webContents.getOSProcessId(), {
        kind: 'tab',
        title: tab?.title || tab?.url || 'Tab',
        tabId: id,
        canSleep: !this.attached.includes(id),
      })
    }
    const ui = (wc: WebContents | undefined, title: string) => wc && !wc.isDestroyed() && byPid.set(wc.getOSProcessId(), { kind: 'ui', title })
    ui(this.win.webContents, 'Sidebar')
    ui(this.overlay?.webContents, 'Command bar & Library')
    ui(this.findView?.webContents, 'Find bar')
    ui(this.previewView?.webContents, 'Peek preview')
    return app
      .getAppMetrics()
      .map((m): TaskInfo => {
        const known = byPid.get(m.pid)
        const kind: TaskInfo['kind'] = known?.kind ?? (m.type === 'Browser' ? 'browser' : m.type === 'GPU' ? 'gpu' : 'other')
        const title =
          known?.title ??
          (m.type === 'Browser' ? 'Browser' : m.type === 'GPU' ? 'Graphics (GPU)' : m.type === 'Tab' ? 'Extension or helper' : m.name || m.serviceName || m.type)
        return {
          pid: m.pid,
          kind,
          title,
          tabId: known?.tabId,
          canSleep: known?.canSleep,
          memoryMB: Math.round(m.memory.workingSetSize / 1024),
          cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
        }
      })
      .sort((a, b) => b.memoryMB - a.memoryMB)
  }

  // ───────────────────────────── Boosts ─────────────────────────────

  /** CSS inserted into each page by Boosts, so it can be replaced when a Boost is edited. */
  private boostCss = new Map<number, string[]>()

  /** Apply matching Boosts: CSS always; JavaScript only on page load (`withJs`). */
  private async applyBoosts(wc: WebContents, withJs: boolean) {
    if (wc.isDestroyed()) return
    const old = this.boostCss.get(wc.id) ?? []
    this.boostCss.delete(wc.id)
    for (const key of old) await wc.removeInsertedCSS(key).catch(() => {})
    const matches = boostsFor(this.state.boosts, wc.getURL())
    const keys: string[] = []
    for (const b of matches) {
      // Author origin (the default), not 'user': Electron 45.2 cannot remove user-origin
      // CSS again, which would leave a disabled or edited Boost stuck on the page.
      if (b.css.trim()) keys.push(await wc.insertCSS(b.css).catch(() => ''))
      if (withJs && b.js.trim()) void wc.executeJavaScript(wrapBoostScript(b.js)).catch(() => {})
    }
    if (keys.length) this.boostCss.set(wc.id, keys.filter(Boolean))
  }

  /** Re-apply Boost CSS to every open page (after an edit), without re-running scripts. */
  private refreshBoosts() {
    for (const view of this.views.values()) void this.applyBoosts(view.webContents, false)
    if (this.previewView) void this.applyBoosts(this.previewView.webContents, false)
  }

  saveBoost(input: Boost): Boost | null {
    const domain = normalizeDomain(String(input.domain ?? ''))
    if (!domain) return null
    const clean: Boost = {
      id: typeof input.id === 'string' && input.id ? input.id : randomUUID(),
      domain,
      enabled: input.enabled !== false,
      css: String(input.css ?? '').slice(0, 100_000),
      js: String(input.js ?? '').slice(0, 100_000),
      updated: Date.now(),
    }
    const i = this.state.boosts.findIndex((b) => b.id === clean.id)
    if (i >= 0) this.state.boosts[i] = clean
    else this.state.boosts.push(clean)
    this.emit()
    this.refreshBoosts()
    return clean
  }

  deleteBoost(id: string) {
    this.state.boosts = this.state.boosts.filter((b) => b.id !== id)
    this.emit()
    this.refreshBoosts()
  }

  /** Zap: hide the element under the pointer on this site, for good (editable in Boosts). */
  async zapAt(wc: WebContents, x: number, y: number) {
    if (this.isPrivatePage(wc)) return // a Boost would record the site's name
    const selector = (await wc.executeJavaScript(selectorScript(x, y)).catch(() => null)) as string | null
    const url = wc.getURL()
    const domain = Shields.siteOf(url) ?? normalizeDomain(url)
    if (!selector || !domain) return
    const existing = this.state.boosts.find((b) => b.domain === domain)
    const rule = hideRule(selector)
    if (existing) {
      if (!existing.css.includes(rule)) this.saveBoost({ ...existing, enabled: true, css: `${existing.css.trimEnd()}\n${rule}\n`.trimStart() })
    } else {
      this.saveBoost({ id: '', domain, enabled: true, css: `/* Zapped elements */\n${rule}\n`, js: '', updated: 0 })
    }
  }

  // ───────────────────────────── split view ─────────────────────────────

  /** Show `tabId` side by side with the active tab (active on the left). */
  createSplit(tabId: string, leftId = this.state.activeTabId) {
    if (!leftId || leftId === tabId || !this.tab(tabId) || !this.tab(leftId)) return
    // A tab is in at most one split.
    this.state.splits = this.state.splits.filter((s) => !s.tabIds.includes(tabId) && !s.tabIds.includes(leftId))
    this.state.splits.push({ id: randomUUID(), tabIds: [leftId, tabId], ratio: 0.5 })
    this.activate(tabId)
    this.emit()
  }

  /** ⌃⇧=: pick a new page for the right side via the command bar. */
  splitWithNewTab() {
    if (!this.state.activeTabId) return this.openCommandBar('new')
    this.pendingSplitWith = this.state.activeTabId
    this.openCommandBar('new')
  }

  exitSplit(id: string, keep = this.state.activeTabId ?? undefined) {
    const split = this.state.splits.find((s) => s.id === id)
    if (!split) return
    this.state.splits = this.state.splits.filter((s) => s.id !== id)
    const show = keep && split.tabIds.includes(keep) ? keep : split.tabIds[0]
    if (this.state.activeTabId && split.tabIds.includes(this.state.activeTabId)) this.attach(show)
    this.emit()
  }

  swapSplit(id: string) {
    const split = this.state.splits.find((s) => s.id === id)
    if (!split) return
    split.tabIds = [split.tabIds[1], split.tabIds[0]]
    split.ratio = 1 - split.ratio
    if (this.attached.length === 2 && split.tabIds.includes(this.attached[0])) this.attach(this.state.activeTabId)
    this.emit()
  }

  resizeSplit(id: string, ratio: number) {
    const split = this.state.splits.find((s) => s.id === id)
    if (!split || !Number.isFinite(ratio)) return
    split.ratio = Math.min(0.8, Math.max(0.2, ratio))
    this.layout()
    this.emit()
  }

  /** While dragging the divider, the overlay covers the window so mouse moves reach the UI. */
  setSplitDragging(active: boolean) {
    if (this.splitDragging === active) return
    this.splitDragging = active
    const overlay = this.ensureOverlay()
    if (active) this.win.contentView.addChildView(overlay)
    else if (!this.overlayVisible()) this.win.contentView.removeChildView(overlay)
    this.layout()
    this.emitNow()
  }

  // ───────────────────────────── Peek (link preview) ─────────────────────────────

  private previewRect(): Electron.Rectangle {
    const box = this.contentBox()
    const margin = Math.max(24, Math.round(box.width * 0.06))
    const toolbar = 52
    return {
      x: box.x + margin,
      y: box.y + toolbar,
      width: Math.max(200, box.width - margin * 2),
      height: Math.max(200, box.height - toolbar - margin / 2),
    }
  }

  /** Show `url` in a floating card over the page (Arc's Peek). */
  openPreview(url: string, partition: string) {
    if (this.commandBar) this.closeCommandBar()
    if (this.library) this.closeLibrary()
    this.closeFind()
    if (this.previewView && this.previewPartition !== partition) this.destroyPreview()
    if (!this.previewView) {
      const view = new WebContentsView({ webPreferences: pagePreferences(partition) })
      view.setBackgroundColor('#ffffff')
      view.setBorderRadius(VIEW_RADIUS)
      const wc = view.webContents
      const sync = () => {
        if (!this.preview || wc.isDestroyed()) return
        this.preview.url = wc.getURL() || this.preview.url
        this.preview.title = wc.getTitle()
        this.preview.loading = wc.isLoading()
        this.preview.canGoBack = wc.navigationHistory.canGoBack()
        this.emit(false)
      }
      wc.on('did-start-loading', sync)
      wc.on('did-stop-loading', sync)
      wc.on('dom-ready', () => void this.applyBoosts(wc, true))
      wc.on('did-navigate', sync)
      wc.on('did-navigate-in-page', sync)
      wc.on('page-title-updated', sync)
      wc.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          e.preventDefault()
          this.closePreview()
        }
      })
      // Links that would open yet another tab replace the preview instead.
      wc.setWindowOpenHandler(({ url: next }) => {
        void wc.loadURL(next).catch(() => {})
        return { action: 'deny' }
      })
      attachWebContextMenu(this, wc)
      this.previewView = view
      this.previewPartition = partition
    }
    this.preview = { url, title: url, loading: true, canGoBack: false }
    void this.previewView.webContents.loadURL(url).catch(() => {})
    this.ensureOverlay()
    this.raiseFloating()
    this.layout()
    this.previewView.webContents.focus()
    this.emitNow()
  }

  private previewPartition = ''

  // ───────────────────────────── Little Arc ─────────────────────────────

  private littles = new Set<LittleWindow>()

  /** ⌥⌘N, or a link from another app: a small window for a quick look. */
  openLittle(url?: string, fromOutside = false) {
    // Links from other apps never land in private browsing.
    const space = fromOutside && this.space().private ? this.state.spaces[0] : this.space()
    const little = new LittleWindow(
      {
        rendererUrl: this.rendererUrl,
        partition: space.partition,
        spaceName: space.name,
        color: space.color,
        searchEngine: () => this.state.searchEngine,
        onToMain: (pageUrl) => {
          this.openTab(pageUrl)
          if (this.win.isMinimized()) this.win.restore()
          this.win.focus()
        },
        onVisit: (pageUrl, title) => {
          if (!pageUrl.startsWith('http') || space.private) return
          this.record((db) => (title ? db.setTitle(pageUrl, title) : db.addVisit(pageUrl, '')))
        },
        wirePage: (wc) => attachWebContextMenu(this, wc),
      },
      url,
    )
    this.littles.add(little)
    little.win.on('closed', () => this.littles.delete(little))
    return little
  }

  /** The Little Arc window whose toolbar sent an action, if any. */
  /**
   * A window a site opens itself, such as "Continue with Google". Chromium has
   * already made its page (`options.webContents`), tied to the page that opened
   * it; it is shown in a small window of ours that says whose page it is.
   */
  private openPopup(openerTabId: string, options: PopupOptions): WebContents {
    const opener = this.tab(openerTabId)
    const space = this.state.spaces.find((sp) => sp.id === opener?.spaceId) ?? this.space()
    const little = new LittleWindow({
      rendererUrl: this.rendererUrl,
      partition: space.partition,
      spaceName: space.name,
      color: space.color,
      searchEngine: () => this.state.searchEngine,
      onToMain: () => {},
      onVisit: () => {}, // sign-in windows don't belong in history
      wirePage: (wc) => attachWebContextMenu(this, wc),
      popup: { webContents: options.webContents, width: options.width, height: options.height },
    })
    this.littles.add(little)
    little.win.on('closed', () => this.littles.delete(little))
    return little.pageWebContents
  }

  littleFor(wc: WebContents): LittleWindow | undefined {
    for (const l of this.littles) if (l.isUI(wc)) return l
    return undefined
  }

  handleLittleAction(little: LittleWindow, action: Action) {
    switch (action.type) {
      case 'little.ready':
        return little.send()
      case 'little.navigate':
        return little.navigate(String(action.input ?? '').slice(0, 4000))
      case 'little.back':
        return little.back()
      case 'little.forward':
        return little.forward()
      case 'little.reload':
        return little.reload()
      case 'little.toMain':
        return little.toMain()
    }
  }

  /** Is this page part of private browsing? */
  isPrivatePage(wc: WebContents): boolean {
    const partition = this.partitionForWebContents(wc)
    return this.state.spaces.some((s) => s.private && s.partition === partition)
  }

  /** The profile a page runs in: its tab's, Peek's, or the current space's. */
  partitionForWebContents(wc: WebContents): string {
    const id = this.tabIdForWebContents(wc)
    const tab = id ? this.tab(id) : undefined
    if (tab) return this.partitionOf(tab)
    if (wc === this.previewView?.webContents) return this.previewPartition
    return this.currentPartition()
  }

  /** Close Peek and free its page (memory matters on the Intel Mac). */
  closePreview() {
    if (!this.preview) return
    this.preview = null
    this.destroyPreview()
    if (this.overlay && !this.overlayVisible()) this.win.contentView.removeChildView(this.overlay)
    this.layout()
    this.activeWebContents()?.focus()
    this.emit(false)
  }

  private destroyPreview() {
    const view = this.previewView
    this.previewView = null
    if (!view) return
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  /** "Open in New Tab": keep reading the previewed page as a normal tab. */
  previewToTab() {
    if (!this.preview) return
    const url = this.previewView?.webContents.getURL() || this.preview.url
    this.closePreview()
    this.openTab(url, { afterTabId: this.state.activeTabId ?? undefined })
  }

  // ───────────────────────────── find in page ─────────────────────────────

  openFind() {
    const wc = this.activeWebContents()
    if (!wc || this.commandBar || this.library) return
    this.closePreview()
    if (this.findIdleTimer) clearTimeout(this.findIdleTimer)
    this.findIdleTimer = null
    this.find ??= { query: '', active: 0, total: 0, focusToken: 0 }
    this.find.focusToken++
    if (!this.findView) {
      const view = new WebContentsView({
        webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      view.setBackgroundColor('#00000000')
      void view.webContents.loadURL(`${this.rendererUrl}#find`)
      view.webContents.on('did-finish-load', () => this.emitNow())
      this.findView = view
    }
    this.win.contentView.addChildView(this.findView)
    if (this.overlayVisible()) this.win.contentView.addChildView(this.overlay!)
    this.layout()
    this.findView.webContents.focus()
    this.emitNow()
  }

  /** New text (`next` false) or Enter / ⇧Enter / ⌘G (`next` true). */
  findQuery(text: string, forward = true, next = false) {
    const wc = this.activeWebContents()
    if (!wc || !this.find) return
    this.find.query = text
    if (!text) {
      wc.stopFindInPage('clearSelection')
      this.find.active = 0
      this.find.total = 0
      this.emit(false)
      return
    }
    wc.findInPage(text, { forward, findNext: !next })
    // Highlighting a match can pull focus into the page; keep typing in the bar.
    this.findView?.webContents.focus()
  }

  closeFind() {
    if (!this.find) return
    const wc = this.activeWebContents()
    wc?.stopFindInPage('keepSelection')
    this.find = null
    if (this.findView) this.win.contentView.removeChildView(this.findView)
    wc?.focus()
    this.emit(false)
    // Keep the bar's page around briefly for a quick second search, then free it.
    if (this.findIdleTimer) clearTimeout(this.findIdleTimer)
    this.findIdleTimer = setTimeout(() => {
      this.findIdleTimer = null
      const view = this.findView
      if (!view || this.find) return
      this.findView = null
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }, FIND_VIEW_IDLE_MS)
  }

  private findIdleTimer: NodeJS.Timeout | null = null

  /** ⌘G / ⇧⌘G from the menu. */
  findAgain(forward: boolean) {
    if (!this.find) return this.openFind()
    this.findQuery(this.find.query, forward, true)
  }

  // ───────────────────────────── Library (History / Downloads / Settings) ─────────────────────────────

  openLibrary(tab: LibraryTab) {
    this.closePreview()
    this.commandBar = null
    this.peek = false
    this.closeFind()
    this.library = { tab }
    if (tab === 'downloads') this.markDownloadsSeen()
    const overlay = this.ensureOverlay()
    this.win.contentView.addChildView(overlay)
    this.applyWindowButtons()
    this.layout()
    overlay.webContents.focus()
    this.emitNow()
  }

  closeLibrary() {
    if (!this.library) return
    this.library = null
    if (this.overlay) this.win.contentView.removeChildView(this.overlay)
    this.layout()
    this.activeWebContents()?.focus()
    this.emitNow()
  }

  private markDownloadsSeen() {
    this.downloadsUnseen = false
    this.seenCompleted = this.downloads?.recent().filter((d) => d.state === 'completed').length ?? 0
  }

  /** Progress or a finished download: refresh the UI (and flag finished ones as new). */
  downloadsChanged() {
    const completed = this.downloads?.recent().filter((d) => d.state === 'completed').length ?? 0
    if (completed > this.seenCompleted) {
      if (this.library?.tab === 'downloads') this.seenCompleted = completed
      else this.downloadsUnseen = true
    }
    this.emit(false)
  }

  private updateSettingsFromUI(patch: Partial<Settings>) {
    const clean: Partial<Settings> = {}
    if ([0, 5, 15, 30, 60].includes(Number(patch.sleepAfterMinutes))) clean.sleepAfterMinutes = Number(patch.sleepAfterMinutes)
    if ([0, 12, 24, 168, 720].includes(Number(patch.archiveAfterHours))) clean.archiveAfterHours = Number(patch.archiveAfterHours)
    if (typeof patch.preferH264 === 'boolean') clean.preferH264 = patch.preferH264
    if (typeof patch.peekFromPinned === 'boolean') clean.peekFromPinned = patch.peekFromPinned
    if (typeof patch.littleArcForLinks === 'boolean') clean.littleArcForLinks = patch.littleArcForLinks
    if (patch.appearance === 'system' || patch.appearance === 'light' || patch.appearance === 'dark') clean.appearance = patch.appearance
    if (typeof patch.translateTo === 'string' && patch.translateTo in LANGUAGES) clean.translateTo = patch.translateTo
    if (typeof patch.autoPip === 'boolean') clean.autoPip = patch.autoPip
    if (Object.keys(clean).length) this.updateSettings(clean)
  }

  private updateShieldsFromUI(patch: Partial<ShieldsSettings>) {
    const clean: Partial<ShieldsSettings> = {}
    for (const key of ['enabled', 'blockCookieBanners', 'upgradeHttps', 'stripTrackingParams'] as const) {
      if (typeof patch[key] === 'boolean') clean[key] = patch[key]
    }
    if (Array.isArray(patch.disabledSites)) clean.disabledSites = patch.disabledSites.filter((d) => typeof d === 'string').slice(0, 1000)
    if (Object.keys(clean).length) this.updateShields(clean)
  }

  private async clearData(what: 'cache' | 'cookies') {
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'warning',
      buttons: [what === 'cache' ? 'Clear Cache' : 'Clear Cookies', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: what === 'cache' ? 'Clear cached files for all spaces?' : 'Clear cookies for all spaces?',
      detail:
        what === 'cache'
          ? 'Pages may load a little slower the first time afterwards.'
          : 'You will be signed out of websites. Extensions such as Bitwarden keep their data.',
    })
    if (response !== 0) return
    for (const partition of new Set(this.state.spaces.map((s) => s.partition))) {
      const ses = session.fromPartition(partition)
      if (what === 'cache') await ses.clearCache()
      else await ses.clearStorageData({ storages: ['cookies'] })
    }
  }

  // ───────────────────────────── import from Arc ─────────────────────────────

  async importFromArc() {
    let file = ARC_SIDEBAR_FILE
    if (!existsSync(file)) {
      const picked = await dialog.showOpenDialog(this.win, {
        title: 'Choose Arc’s StorableSidebar.json',
        message: 'Arc keeps it in ~/Library/Application Support/Arc/',
        properties: ['openFile'],
        filters: [{ name: 'Arc sidebar', extensions: ['json'] }],
      })
      if (picked.canceled || !picked.filePaths[0]) return
      file = picked.filePaths[0]
    }

    let plan
    try {
      plan = parseArcSidebar(JSON.parse(readFileSync(file, 'utf8')))
    } catch (err) {
      await dialog.showMessageBox(this.win, { type: 'error', message: 'Couldn’t read Arc’s data', detail: String(err) })
      return
    }
    const n = countPlan(plan)
    if (!n.spaces && !n.favorites) {
      await dialog.showMessageBox(this.win, { type: 'info', message: 'Nothing to import', detail: 'No spaces or favorites were found in that file.' })
      return
    }

    const arcDir = dirname(file)
    const profiles = [...new Set([...plan.spaces.map((s) => s.profile), ...plan.favorites.map((f) => f.profile)])]
    const hasHistory = profiles.some((p) => existsSync(arcHistoryPath(arcDir, p)))
    const parts = [
      `${n.spaces} space${n.spaces === 1 ? '' : 's'}`,
      `${n.pinned} pinned tab${n.pinned === 1 ? '' : 's'}${n.folders ? ` in ${n.folders} folder${n.folders === 1 ? '' : 's'}` : ''}`,
      `${n.favorites} favorite${n.favorites === 1 ? '' : 's'}`,
      ...(n.today ? [`${n.today} Today tab${n.today === 1 ? '' : 's'}`] : []),
    ]
    const { response, checkboxChecked } = await dialog.showMessageBox(this.win, {
      type: 'question',
      buttons: ['Import', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Import from Arc?',
      detail:
        `Found ${parts.join(', ')}.\n\nThey are added as new spaces; your current spaces stay as they are.` +
        (n.profiles > 1 ? ' Arc profiles become separate profiles here (you’ll need to sign in to sites again there).' : '') +
        ' Passwords and cookies aren’t imported.',
      checkboxLabel: hasHistory ? 'Also import browsing history (last 90 days)' : undefined,
      checkboxChecked: hasHistory,
    })
    if (response !== 0) return

    // Arc's main profile maps to ours; other Arc profiles get their own sessions.
    const mainPartition = this.state.spaces[0].partition
    const partitionFor = (profile: string) =>
      profile === ARC_DEFAULT_PROFILE ? mainPartition : `persist:arc-${profile.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    for (const p of profiles) if (p !== ARC_DEFAULT_PROFILE) await this.prepareSession(partitionFor(p))

    const created = applyArcPlan(this.state, plan, {
      partitionFor,
      newId: () => randomUUID(),
      palette: SPACE_COLORS.map((c) => c.value),
      now: Date.now(),
    })
    if (created[0]) this.switchSpace(created[0])
    this.emit()

    let pages = 0
    if (hasHistory && checkboxChecked) {
      const since = Date.now() - 90 * 86_400_000
      for (const p of profiles) {
        try {
          const rows = readArcHistory(arcHistoryPath(arcDir, p), since)
          this.record((db) => (pages += db.importUrls(rows)))
        } catch (err) {
          console.error(`Arc history import failed for ${p}:`, err)
        }
      }
    }
    await dialog.showMessageBox(this.win, {
      type: 'info',
      message: 'Imported from Arc',
      detail: `Added ${parts.join(', ')}${pages ? `, and ${pages.toLocaleString()} pages of history` : ''}.`,
    })
  }

  // ───────────────────────────── queries from the UI ─────────────────────────────

  query(q: Query): unknown {
    switch (q.type) {
      case 'history.suggest':
        return this.db?.suggest(String(q.input ?? '').slice(0, 200), 6) ?? []
      case 'history.list':
        return this.db?.listVisits({ query: q.query ? String(q.query).slice(0, 200) : undefined, before: Number(q.before) || undefined, limit: 200 }) ?? []
      case 'permissions.list':
        return this.db?.listPermissions() ?? []
      case 'tasks.list':
        return this.tasks()
      case 'app.info': {
        const info: AppInfo = {
          version: app.getVersion(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          isDefaultBrowser: app.isDefaultProtocolClient('https'),
          arcFound: existsSync(ARC_SIDEBAR_FILE),
          historyCount: this.db?.historyCount() ?? 0,
          widevine: widevineVersion(),
        }
        return info
      }
    }
    return null
  }

  // ───────────────────────────── IPC entry point ─────────────────────────────

  handleAction(action: Action) {
    switch (action.type) {
      case 'tab.activate':
        return this.activate(action.id)
      case 'tab.close':
        return this.closeTab(action.id)
      case 'tab.open':
        this.closeCommandBar(true)
        this.navigate(action.input, action.mode)
        this.pendingSplitWith = null
        return
      case 'tab.togglePin':
        return this.togglePin(action.id)
      case 'tab.contextMenu':
        return this.showTabMenu(action.id)
      case 'nav.back':
        return this.activeWebContents()?.navigationHistory.goBack()
      case 'nav.forward':
        return this.activeWebContents()?.navigationHistory.goForward()
      case 'nav.reload':
        return this.activeWebContents()?.reload()
      case 'commandBar.open':
        return this.openCommandBar(action.mode)
      case 'commandBar.close':
        return this.closeCommandBar()
      case 'sidebar.toggle':
        return this.toggleSidebar()
      case 'sidebar.peek':
        return action.open ? this.setPeek(true) : this.peekLeft()
      case 'tab.sleep':
        return this.sleepTab(action.id)
      case 'shields.menu':
        return this.showShieldsMenu()
      case 'page.translate':
        return void this.translateActive()
      case 'page.showOriginal':
        return void this.showOriginal()
      case 'page.pip':
        return this.togglePip()
      case 'site.info': {
        const tab = this.activeTab()
        if (!tab) return
        return void showSiteInfo({
          win: this.win,
          url: tab.url,
          partition: this.partitionOf(tab),
          reload: () => this.activeWebContents()?.reload(),
          openSettings: () => this.openLibrary('settings'),
        })
      }
      case 'tabs.clearToday':
        return this.clearToday()
      case 'archive.restore':
        return this.restoreArchived(action.index)
      case 'tab.toggleFavorite':
        return this.toggleFavorite(action.id)
      case 'item.move':
        return this.moveItem(action.id, action.to, Number(action.index) || 0)
      case 'space.switch':
        return this.switchSpace(action.id)
      case 'space.cycle':
        return this.cycleSpace(action.delta === -1 ? -1 : 1)
      case 'space.addMenu':
        return this.showAddSpaceMenu()
      case 'space.private':
        return void this.openPrivate()
      case 'space.closePrivate':
        if (spaceById(this.state, action.id)?.private) this.deleteSpace(action.id)
        return
      case 'space.menu':
        return this.showSpaceMenu(action.id)
      case 'space.rename':
        return this.renameSpace(action.id, String(action.name ?? ''))
      case 'folder.toggle':
        return this.toggleFolder(action.id)
      case 'folder.rename':
        return this.renameFolder(action.id, String(action.name ?? ''))
      case 'folder.menu':
        return this.showFolderMenu(action.id)
      case 'folder.create':
        return this.newFolder(action.list === 'today' ? 'today' : 'pinned')
      case 'edit.cancel':
        this.editing = null
        return this.emit(false)
      case 'tabs.tidy':
        return this.tidy()
      case 'library.open':
        return this.openLibrary(['history', 'downloads', 'settings', 'boosts', 'tasks'].includes(action.tab) ? action.tab : 'history')
      case 'library.close':
        return this.closeLibrary()
      case 'download.act':
        return this.downloads?.act(String(action.id), action.op)
      case 'downloads.clear':
        return this.downloads?.clear()
      case 'history.delete':
        this.record((db) => db.deleteUrl(String(action.url)))
        return this.emit(false)
      case 'history.clear':
        this.record((db) => db.deleteSince(Math.max(0, Number(action.since) || 0)))
        return this.emit(false)
      case 'settings.update':
        return this.updateSettingsFromUI(action.patch ?? {})
      case 'searchEngine.set':
        if (action.id in SEARCH_ENGINES) {
          this.state.searchEngine = action.id
          this.emit()
        }
        return
      case 'shields.update':
        return this.updateShieldsFromUI(action.patch ?? {})
      case 'permissions.forget':
        forgetPermission({ partition: String(action.partition), origin: String(action.origin), permission: String(action.permission) })
        return this.emit(false)
      case 'browser.makeDefault':
        app.setAsDefaultProtocolClient('http')
        app.setAsDefaultProtocolClient('https')
        return this.emit(false)
      case 'auth.submit':
        return this.answerAuth(String(action.username ?? ''), String(action.password ?? ''))
      case 'auth.cancel':
        return this.answerAuth()
      case 'split.create':
        return this.createSplit(String(action.tabId))
      case 'split.newTab':
        return this.splitWithNewTab()
      case 'split.exit':
        return this.exitSplit(String(action.id))
      case 'split.swap':
        return this.swapSplit(String(action.id))
      case 'split.resize':
        return this.resizeSplit(String(action.id), Number(action.ratio))
      case 'split.drag':
        return this.setSplitDragging(!!action.active)
      case 'little.open':
        return void this.openLittle(typeof action.url === 'string' ? action.url : undefined)
      case 'space.update':
        return this.updateSpaceTheme(String(action.id), action.color, action.gradient)
      case 'boost.save':
        this.saveBoost(action.boost)
        return
      case 'boost.delete':
        return this.deleteBoost(String(action.id))
      case 'preview.close':
        return this.closePreview()
      case 'preview.toTab':
        return this.previewToTab()
      case 'preview.back':
        return this.previewView?.webContents.navigationHistory.goBack()
      case 'find.open':
        return this.openFind()
      case 'find.query':
        return this.findQuery(String(action.text ?? '').slice(0, 500), action.forward !== false, !!action.next)
      case 'find.close':
        return this.closeFind()
      case 'arc.import':
        this.closeLibrary()
        return void this.importFromArc()
      case 'data.clear':
        return void this.clearData(action.what === 'cache' ? 'cache' : 'cookies')
    }
  }
}

function timeAgo(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.round(h / 24)} days ago`
}

function isWebUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://')
}

function stripHash(url: string): string {
  const i = url.indexOf('#')
  return i < 0 ? url : url.slice(0, i)
}

/** Installed Widevine version, or null if it isn't ready (or this isn't the Widevine-enabled Electron build). */
function widevineVersion(): string | null {
  try {
    const status = components?.status()?.[components.WIDEVINE_CDM_ID]
    return status?.version && status.status !== 'error' ? status.version : null
  } catch {
    return null
  }
}
