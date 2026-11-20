import { BrowserWindow, Menu, WebContentsView, app, clipboard, dialog, nativeTheme, session, shell as electronShell, type WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { SIDEBAR_WIDTH, SPACE_COLORS, VIEW_GAP, VIEW_RADIUS } from '../shared/constants'
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
  UIState,
} from '../shared/types'
import { IPC } from '../shared/types'
import { SEARCH_ENGINES, displayHost, resolveInput } from '../shared/url'
import { boostsFor, hideRule, normalizeDomain, selectorScript, wrapBoostScript } from '../shared/boosts'
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
import { forgetPermission } from './permissions'
import { LittleWindow } from './little'
import { Shields } from './shields'
import { flushState, saveState } from './store'

const MAX_CLOSED = 25
const NEW_TAB_TITLE = 'New Tab'
/** How often the sidebar UI is refreshed at most. Keeps busy pages cheap. */
const EMIT_INTERVAL_MS = 50
const SLEEP_CHECK_MS = 60_000
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
  prepareSession: (partition: string) => Promise<void> = async () => {}
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
      trafficLightPosition: { x: 16, y: 17 },
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
    this.win.on('enter-full-screen', () => this.layout())
    this.win.on('leave-full-screen', () => this.layout())
    this.win.on('close', () => {
      saveState(this.state)
      flushState()
    })
    this.win.on('closed', () => {
      clearInterval(this.sleepTimer)
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
    return !!this.overlay && (!!this.commandBar || this.peek || !!this.library || this.splitDragging || !!this.preview)
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
  private contentBox() {
    const [width, height] = this.win.getContentSize()
    const left = this.state.sidebarVisible ? SIDEBAR_WIDTH : VIEW_GAP
    return { x: left, y: VIEW_GAP, width: Math.max(0, width - left - VIEW_GAP), height: Math.max(0, height - VIEW_GAP * 2) }
  }

  /** Rectangles for the visible panes: one full box, or two side by side for a split. */
  private paneRects(): Map<string, Electron.Rectangle> {
    const box = this.contentBox()
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
      view.setBorderRadius(VIEW_RADIUS)
    }
    // Command bar, Library, split dragging: whole window. Peek sidebar: just its strip.
    this.overlay?.setBounds(
      this.commandBar || this.library || this.splitDragging || this.preview
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

  /** macOS traffic lights live in the sidebar; hide them when it is hidden. */
  private applyWindowButtons() {
    if (process.platform !== 'darwin' || this.win.isDestroyed()) return
    this.win.setWindowButtonVisibility(this.state.sidebarVisible || this.peek)
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
      webPreferences: {
        ...adopt?.webPreferences,
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
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
      getExtensions(partition).addTab(view.webContents, this.win)
    } finally {
      this.registeringTab = false
    }
    return view
  }

  private wireView(id: string, view: WebContentsView) {
    const wc = view.webContents
    const rt = () => this.runtime[id]
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
      update({ url, title: displayHost(url) })
      this.layout()
    })
    wc.on('did-stop-loading', () => {
      if (rt()) rt().loading = false
      syncNav()
    })
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      this.typedIn.delete(id)
      update({ url, favicon: undefined })
      syncNav()
      if (isWebUrl(url) && httpResponseCode < 400) this.record((db) => db.addVisit(url, ''))
      lastRecorded = stripHash(url)
    })
    let lastRecorded = ''
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      // Single-page apps (YouTube, Gmail) change pages without reloading: record those too.
      if (!isMainFrame || !isWebUrl(url) || stripHash(url) === lastRecorded) return
      lastRecorded = stripHash(url)
      this.record((db) => db.addVisit(url, wc.getTitle()))
    })
    wc.on('before-input-event', (_e, input) => {
      // Typing (not shortcuts) means there may be unsaved text: don't sleep this tab.
      if (input.type === 'keyDown' && !input.meta && !input.control && input.key.length === 1) this.typedIn.add(id)
    })
    wc.on('did-navigate-in-page', syncNav)
    wc.on('page-title-updated', (_e, title) => {
      update({ title: title || NEW_TAB_TITLE })
      const url = wc.getURL()
      if (isWebUrl(url)) this.record((db) => db.setTitle(url, title))
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      update({ favicon: favicons[0] })
      const url = wc.getURL()
      if (favicons[0] && isWebUrl(url)) this.record((db) => db.setFavicon(url, favicons[0]))
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
        getExtensions(this.partitionOf(tab)).selectTab(wc)
        this.emit()
      }
    }
    wc.on('focus', focusPane)
    wc.on('before-mouse-event', (_e, mouse) => {
      if (mouse.type === 'mouseDown') focusPane()
    })
    wc.on('dom-ready', () => void this.applyBoosts(wc, true))
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
      this.layout()
      this.emit(false)
    })
    wc.on('leave-html-full-screen', () => {
      if (this.fullscreenTab === id) this.fullscreenTab = null
      this.layout()
      this.emit(false)
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
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            webPreferences: { partition: this.partitionOf(this.tab(id)!), sandbox: true, contextIsolation: true },
          },
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
    const wc = view.webContents
    if (keepHistory && !wc.isDestroyed()) {
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
    delete this.runtime[id]
    if (!wc.isDestroyed()) wc.close()
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
    this.emit(false)
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
    if (!this.commandBar) view.webContents.focus()
    getExtensions(this.partitionOf(tab)).selectTab(view.webContents)
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
    if (!space || this.state.spaces.length < 2) return
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
    this.emit()
  }

  showSpaceMenu(id: string) {
    const space = spaceById(this.state, id)
    if (!space) return
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

  toggleSidebar() {
    this.state.sidebarVisible = !this.state.sidebarVisible
    if (this.peek) this.setPeek(false)
    this.applyWindowButtons()
    this.layout()
    this.emit()
  }

  /** Arc-style: hovering the left edge shows the hidden sidebar over the page. */
  setPeek(open: boolean) {
    if (open && (this.state.sidebarVisible || this.fullscreenTab || this.commandBar || this.library)) return
    if (this.peek === open) return
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
    const otherSpaces = this.state.spaces.filter((s) => s.id !== tab.spaceId)
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

    const updated = status?.updatedAt ? `Filter lists updated ${timeAgo(status.updatedAt)}` : 'Filter lists not downloaded yet'
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: s.enabled && siteOn ? `${blocked} blocked on this page` : 'Shields are off for this page', enabled: false },
      { type: 'separator' },
      {
        label: site ? `Shields on for ${site}` : 'Shields on for this site',
        type: 'checkbox',
        checked: siteOn,
        enabled: !!site && s.enabled,
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
      if (b.css.trim()) keys.push(await wc.insertCSS(b.css, { cssOrigin: 'user' }).catch(() => ''))
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
      const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } })
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
  openLittle(url?: string) {
    const space = this.space()
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
          if (!pageUrl.startsWith('http')) return
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
  littleFor(wc: WebContents): LittleWindow | undefined {
    for (const l of this.littles) if (l.isUI(wc)) return l
    return undefined
  }

  handleLittleAction(little: LittleWindow, action: Action) {
    switch (action.type) {
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
  }

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
      case 'app.info': {
        const info: AppInfo = {
          version: app.getVersion(),
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          isDefaultBrowser: app.isDefaultProtocolClient('https'),
          arcFound: existsSync(ARC_SIDEBAR_FILE),
          historyCount: this.db?.historyCount() ?? 0,
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
        return this.setPeek(!!action.open)
      case 'tab.sleep':
        return this.sleepTab(action.id)
      case 'shields.menu':
        return this.showShieldsMenu()
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
        return this.openLibrary(['history', 'downloads', 'settings'].includes(action.tab) ? action.tab : 'history')
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
