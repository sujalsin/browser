import { BrowserWindow, Menu, WebContentsView, clipboard, nativeTheme, shell as electronShell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { SIDEBAR_WIDTH, VIEW_GAP, VIEW_RADIUS } from '../shared/constants'
import type { Action, ClosedTab, CommandBarState, PersistedState, Tab, TabRuntime, UIState } from '../shared/types'
import { IPC } from '../shared/types'
import { displayHost, resolveInput } from '../shared/url'
import { attachWebContextMenu } from './context-menu'
import { getExtensions, setExtensionsShell } from './extensions'
import { flushState, saveState } from './store'

const MAX_CLOSED = 25
const NEW_TAB_TITLE = 'New Tab'

interface OpenOptions {
  activate?: boolean
  /** Insert directly after this tab (links opened from a page). */
  afterTabId?: string
  pinned?: boolean
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
  private htmlFullscreen = false
  private closed: ClosedTab[] = []
  private attachedTabId: string | null = null
  /** True while registering a view with the extension system (see createView). */
  registeringTab = false
  private emitQueued = false

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
      this.persist()
      flushState()
    })
    this.win.on('closed', () => {
      // Tab views are not owned by the window; tear them down explicitly.
      for (const id of [...this.views.keys()]) this.unload(id)
      if (this.overlay && !this.overlay.webContents.isDestroyed()) this.overlay.webContents.close()
    })
    this.win.webContents.on('did-finish-load', () => this.emitNow())

    if (this.state.activeTabId) this.activate(this.state.activeTabId)
    this.layout()
  }

  // ───────────────────────────── state helpers ─────────────────────────────

  currentPartition(): string {
    return this.space().partition
  }

  private space() {
    return this.state.spaces.find((s) => s.id === this.state.activeSpaceId) ?? this.state.spaces[0]
  }

  /** Tabs of the active space in sidebar order: pinned first, then Today. */
  private orderedTabs(): Tab[] {
    const inSpace = this.state.tabs.filter((t) => t.spaceId === this.state.activeSpaceId)
    return [...inSpace.filter((t) => t.pinned), ...inSpace.filter((t) => !t.pinned)]
  }

  private tab(id: string | null | undefined): Tab | undefined {
    return id ? this.state.tabs.find((t) => t.id === id) : undefined
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
    return wc === this.win.webContents || wc === this.overlay?.webContents
  }

  snapshot(): UIState {
    return {
      ...this.state,
      runtime: this.runtime,
      commandBar: this.commandBar,
      htmlFullscreen: this.htmlFullscreen,
      platform: process.platform,
    }
  }

  private persist() {
    saveState(this.state)
  }

  /** Coalesce many changes in one tick into a single UI update. */
  private emit() {
    this.persist()
    if (this.emitQueued) return
    this.emitQueued = true
    setImmediate(() => this.emitNow())
  }

  private emitNow() {
    this.emitQueued = false
    if (this.win.isDestroyed()) return
    const snap = this.snapshot()
    this.win.webContents.send(IPC.state, snap)
    if (this.overlay && !this.overlay.webContents.isDestroyed()) this.overlay.webContents.send(IPC.state, snap)
  }

  // ───────────────────────────── layout ─────────────────────────────

  private layout() {
    if (this.win.isDestroyed()) return
    const [width, height] = this.win.getContentSize()
    const view = this.attachedTabId ? this.views.get(this.attachedTabId) : undefined
    if (view) {
      // Failed loads are shown by the UI underneath, so hide the blank page.
      view.setVisible(!this.runtime[this.attachedTabId!]?.error)
      if (this.htmlFullscreen) {
        view.setBounds({ x: 0, y: 0, width, height })
        view.setBorderRadius(0)
      } else {
        const left = this.state.sidebarVisible ? SIDEBAR_WIDTH : VIEW_GAP
        view.setBounds({
          x: left,
          y: VIEW_GAP,
          width: Math.max(0, width - left - VIEW_GAP),
          height: Math.max(0, height - VIEW_GAP * 2),
        })
        view.setBorderRadius(VIEW_RADIUS)
      }
    }
    this.overlay?.setBounds({ x: 0, y: 0, width, height })
  }

  /** Show the view for `id` (or nothing) in the content area. */
  private attach(id: string | null) {
    if (this.attachedTabId === id) return
    const old = this.attachedTabId ? this.views.get(this.attachedTabId) : undefined
    if (old) this.win.contentView.removeChildView(old)
    this.attachedTabId = id
    const view = id ? this.views.get(id) : undefined
    if (view) {
      this.win.contentView.addChildView(view)
      // Keep the command bar overlay on top.
      if (this.commandBar && this.overlay) this.win.contentView.addChildView(this.overlay)
    }
    this.layout()
  }

  // ───────────────────────────── tab views ─────────────────────────────

  private ensureView(tab: Tab): WebContentsView {
    const existing = this.views.get(tab.id)
    if (existing) return existing
    const view = this.createView(tab)
    void view.webContents.loadURL(tab.url).catch(() => {
      /* load errors show up as error pages; nothing to do here */
    })
    return view
  }

  private createView(tab: Tab, adopt?: { webContents?: WebContents; webPreferences?: Electron.WebPreferences }): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        ...adopt?.webPreferences,
        partition: this.space().partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
      ...(adopt?.webContents ? { webContents: adopt.webContents } : {}),
    })
    view.setBackgroundColor('#ffffff')
    this.views.set(tab.id, view)
    this.runtime[tab.id] = { loaded: true, loading: true, canGoBack: false, canGoForward: false, audible: false, muted: false }
    this.wireView(tab.id, view)
    // Registering the first tab makes the extension system "select" it; that
    // must not steal focus from the tab the user is actually on.
    this.registeringTab = true
    try {
      getExtensions(this.space().partition).addTab(view.webContents, this.win)
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
      this.emit()
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 = ERR_ABORTED (navigation replaced by another one); not a real failure.
      if (!isMainFrame || code === -3 || !rt()) return
      rt().error = { code, description, url }
      update({ url, title: displayHost(url) })
      this.layout()
    })
    wc.on('did-stop-loading', () => {
      if (rt()) rt().loading = false
      syncNav()
    })
    wc.on('did-navigate', (_e, url) => {
      update({ url, favicon: undefined })
      syncNav()
    })
    wc.on('did-navigate-in-page', syncNav)
    wc.on('page-title-updated', (_e, title) => update({ title: title || NEW_TAB_TITLE }))
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] }))
    wc.on('audio-state-changed', (e) => {
      if (rt()) rt().audible = e.audible
      this.emit()
    })
    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreen = true
      this.layout()
      this.emit()
    })
    wc.on('leave-html-full-screen', () => {
      this.htmlFullscreen = false
      this.layout()
      this.emit()
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
            webPreferences: { partition: this.space().partition, sandbox: true, contextIsolation: true },
          },
        }
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

  /** Destroy a tab's page but keep it in the sidebar. */
  private unload(id: string) {
    const view = this.views.get(id)
    if (!view) return
    if (this.attachedTabId === id && !this.win.isDestroyed()) this.attach(null)
    this.views.delete(id)
    delete this.runtime[id]
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  // ───────────────────────────── tab operations ─────────────────────────────

  private insertTab(url: string, opts: OpenOptions = {}): Tab {
    const now = Date.now()
    const tab: Tab = {
      id: randomUUID(),
      spaceId: this.state.activeSpaceId,
      url,
      title: url,
      pinned: !!opts.pinned,
      pinnedUrl: opts.pinned ? url : undefined,
      createdAt: now,
      lastActiveAt: now,
    }
    const tabs = this.state.tabs
    let index: number
    const opener = opts.afterTabId ? tabs.findIndex((t) => t.id === opts.afterTabId) : -1
    if (opener >= 0 && !tabs[opener].pinned) {
      index = opener + 1
    } else {
      // Arc puts new tabs at the top of Today.
      index = tabs.findIndex((t) => t.spaceId === tab.spaceId && !t.pinned)
      if (index < 0) index = tabs.length
    }
    tabs.splice(index, 0, tab)
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
    tab.lastActiveAt = Date.now()
    this.state.activeTabId = id
    const view = this.ensureView(tab)
    this.attach(id)
    if (!this.commandBar) view.webContents.focus()
    getExtensions(this.space().partition).selectTab(view.webContents)
    this.emit()
  }

  /** Arc behavior: ⌘W on a pinned tab unloads it and resets it to its pinned URL. */
  closeTab(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    if (tab.pinned) {
      if (!this.views.has(id)) return
      this.selectNeighbor(id)
      this.unload(id)
      if (tab.pinnedUrl) tab.url = tab.pinnedUrl
      this.emit()
      return
    }
    this.removeTab(id)
  }

  /** Remove a tab entirely (also used for pinned tabs from the context menu). */
  removeTab(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    const ordered = this.orderedTabs()
    this.closed.unshift({
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      spaceId: tab.spaceId,
      pinned: tab.pinned,
      index: this.state.tabs.indexOf(tab),
    })
    this.closed.length = Math.min(this.closed.length, MAX_CLOSED)
    if (this.state.activeTabId === id) this.selectNeighbor(id, ordered)
    this.unload(id)
    this.state.tabs = this.state.tabs.filter((t) => t.id !== id)
    this.emit()
  }

  private selectNeighbor(id: string, ordered = this.orderedTabs()) {
    if (this.state.activeTabId !== id) return
    const i = ordered.findIndex((t) => t.id === id)
    // Prefer the tab below, then above, then any loaded tab.
    const next = ordered[i + 1] ?? ordered[i - 1]
    if (next) this.activate(next.id)
    else {
      this.state.activeTabId = null
      this.attach(null)
    }
  }

  reopenClosed() {
    const c = this.closed.shift()
    if (!c) return
    const tab = this.insertTab(c.url, { pinned: c.pinned })
    tab.title = c.title
    tab.favicon = c.favicon
    // Move it back to where it was.
    this.state.tabs.splice(this.state.tabs.indexOf(tab), 1)
    this.state.tabs.splice(Math.min(c.index, this.state.tabs.length), 0, tab)
    this.activate(tab.id)
  }

  togglePin(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    tab.pinned = !tab.pinned
    tab.pinnedUrl = tab.pinned ? tab.url : undefined
    const tabs = this.state.tabs
    tabs.splice(tabs.indexOf(tab), 1)
    if (tab.pinned) {
      tabs.push(tab) // end of the pinned section
    } else {
      const firstToday = tabs.findIndex((t) => t.spaceId === tab.spaceId && !t.pinned)
      tabs.splice(firstToday < 0 ? tabs.length : firstToday, 0, tab)
    }
    this.emit()
  }

  /** Arc's "Clear": archive every unpinned tab in the current space. */
  clearToday() {
    const now = Date.now()
    const today = this.state.tabs.filter((t) => t.spaceId === this.state.activeSpaceId && !t.pinned)
    if (!today.length) return
    for (const t of today) {
      this.state.archive.unshift({ url: t.url, title: t.title, favicon: t.favicon, spaceId: t.spaceId, archivedAt: now })
      this.unload(t.id)
    }
    const ids = new Set(today.map((t) => t.id))
    this.state.tabs = this.state.tabs.filter((t) => !ids.has(t.id))
    if (this.state.activeTabId && ids.has(this.state.activeTabId)) {
      this.state.activeTabId = null
      const first = this.orderedTabs()[0]
      if (first) this.activate(first.id)
      else this.attach(null)
    }
    this.emit()
  }

  restoreArchived(index: number) {
    const item = this.state.archive[index]
    if (!item) return
    this.state.archive.splice(index, 1)
    this.openTab(item.url)
  }

  selectByIndex(n: number) {
    const ordered = this.orderedTabs()
    const tab = n === 9 ? ordered[ordered.length - 1] : ordered[n - 1]
    if (tab) this.activate(tab.id)
  }

  cycle(delta: 1 | -1) {
    const ordered = this.orderedTabs()
    if (!ordered.length) return
    const i = ordered.findIndex((t) => t.id === this.state.activeTabId)
    const next = ordered[(i + delta + ordered.length) % ordered.length]
    this.activate(next.id)
  }

  navigate(input: string, mode: 'new' | 'edit') {
    const url = resolveInput(input, this.state.searchEngine)
    if (!url) return
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
      this.openTab(url)
    }
  }

  toggleSidebar() {
    this.state.sidebarVisible = !this.state.sidebarVisible
    this.layout()
    this.emit()
  }

  copyUrl() {
    const tab = this.activeTab()
    if (tab) clipboard.writeText(tab.url)
  }

  // ───────────────────────────── command bar ─────────────────────────────

  openCommandBar(mode: 'new' | 'edit') {
    const active = this.activeTab()
    if (mode === 'edit' && !active) mode = 'new'
    this.commandBar = { mode, initialInput: mode === 'edit' && active ? active.url : '' }
    if (!this.overlay) {
      this.overlay = new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      this.overlay.setBackgroundColor('#00000000')
      void this.overlay.webContents.loadURL(`${this.rendererUrl}#overlay`)
      this.overlay.webContents.on('did-finish-load', () => this.emitNow())
    }
    this.win.contentView.addChildView(this.overlay)
    this.layout()
    this.overlay.webContents.focus()
    this.emit()
  }

  closeCommandBar() {
    if (!this.commandBar) return
    this.commandBar = null
    if (this.overlay) this.win.contentView.removeChildView(this.overlay)
    this.activeWebContents()?.focus()
    this.emit()
  }

  // ───────────────────────────── sidebar tab menu ─────────────────────────────

  showTabMenu(id: string) {
    const tab = this.tab(id)
    if (!tab) return
    const loaded = this.views.has(id)
    const rt = this.runtime[id]
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => this.togglePin(id) },
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
          this.emit()
        },
      },
      { label: 'Open in Default Browser', click: () => void electronShell.openExternal(tab.url) },
      { type: 'separator' },
    ]
    if (tab.pinned) {
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
        { label: 'Delete Pinned Tab', click: () => this.removeTab(id) },
      )
    } else {
      items.push({ label: 'Close Tab', click: () => this.removeTab(id) })
    }
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  // ───────────────────────────── IPC entry point ─────────────────────────────

  handleAction(action: Action) {
    switch (action.type) {
      case 'tab.activate':
        return this.activate(action.id)
      case 'tab.close':
        return this.closeTab(action.id)
      case 'tab.open':
        this.closeCommandBar()
        return this.navigate(action.input, action.mode)
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
      case 'tabs.clearToday':
        return this.clearToday()
      case 'archive.restore':
        return this.restoreArchived(action.index)
    }
  }
}
