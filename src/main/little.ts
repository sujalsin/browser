import { BrowserWindow, WebContentsView, nativeTheme, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC, type LittleState, type SearchEngineId } from '../shared/types'
import { resolveInput } from '../shared/url'
import { pagePreferences } from './page-prefs'
import { lockInterface } from './interface-guard'

const TOOLBAR = 44
const GAP = 6

export interface LittleOptions {
  rendererUrl: string
  partition: string
  spaceName: string
  color: string
  searchEngine: () => SearchEngineId
  /** "Open in Browser": hand the page to the main window. */
  onToMain: (url: string) => void
  onVisit: (url: string, title: string) => void
  /** Set up context menus etc. for the page, like a normal tab. */
  wirePage: (wc: WebContents) => void
  /**
   * A window a site opened itself (sign-in windows and the like). Its page
   * already exists and is shown as it is: the site that opened it keeps its
   * link to it and closes it when it is done. The toolbar only shows whose
   * page this is; it offers no way to go elsewhere.
   */
  popup?: { webContents: WebContents; width?: number; height?: number }
}

const clamp = (n: number | undefined, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, Math.round(n ?? fallback)))

/**
 * Little Arc: a small window for a quick lookup or a link from another app.
 * The page lives in a WebContentsView under a tiny toolbar (our renderer, #little).
 * The same window, with a read-only toolbar, hosts pages that sites open as popups.
 */
export class LittleWindow {
  readonly win: BrowserWindow
  private view: WebContentsView

  constructor(private opts: LittleOptions, url?: string) {
    const isMac = process.platform === 'darwin'
    const parent = BrowserWindow.getFocusedWindow()
    const [px, py] = parent?.getPosition() ?? [undefined, undefined]
    const popup = opts.popup
    this.win = new BrowserWindow({
      // A popup gets the size its site asked for, within reason.
      width: popup ? clamp(popup.width, 380, 1400, 520) + GAP * 2 : 960,
      height: popup ? clamp(popup.height, 320, 1100, 640) + TOOLBAR + GAP : 680,
      minWidth: popup ? 380 : 420,
      minHeight: 300,
      useContentSize: true,
      autoHideMenuBar: true,
      ...(px !== undefined ? { x: px + 80, y: (py ?? 0) + 60 } : {}),
      show: false,
      title: popup ? '' : 'Little Arc',
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 12, y: 15 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1b22' : '#e9e7f2',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    this.view = popup ? new WebContentsView({ webContents: popup.webContents }) : new WebContentsView({ webPreferences: pagePreferences(opts.partition) })
    this.view.setBackgroundColor('#ffffff')
    this.view.setBorderRadius(8)
    this.win.contentView.addChildView(this.view)

    const wc = this.view.webContents
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate-in-page', 'page-title-updated'] as const) {
      wc.on(ev as 'did-start-loading', () => this.send())
    }
    wc.on('did-navigate', (_e, navUrl) => {
      opts.onVisit(navUrl, '')
      this.send()
    })
    wc.on('page-title-updated', (_e, title) => opts.onVisit(wc.getURL(), title))
    // New-tab links stay in this little window.
    wc.setWindowOpenHandler(({ url: next }) => {
      void wc.loadURL(next).catch(() => {})
      return { action: 'deny' }
    })
    opts.wirePage(wc)

    // The toolbar page's <title> would rename the window; name it after the page instead.
    this.win.on('page-title-updated', (e) => e.preventDefault())
    this.win.on('resize', () => this.layout())
    this.win.on('closed', () => {
      if (!wc.isDestroyed()) wc.close()
    })
    // The page closed itself, or the page that opened it closed it: the window goes with it.
    wc.once('destroyed', () => {
      if (!this.win.isDestroyed()) this.win.close()
    })
    this.win.webContents.on('did-finish-load', () => this.send())
    this.win.once('ready-to-show', () => {
      this.win.show()
      // Nothing to show yet: put the cursor in the address field. A popup: straight to its page.
      if (popup) wc.focus()
      else if (!url) this.win.webContents.focus()
    })
    lockInterface(this.win.webContents, opts.rendererUrl)
    void this.win.loadURL(`${opts.rendererUrl}#little`)
    this.layout()
    if (url) void wc.loadURL(url).catch(() => {})
  }

  get pageWebContents(): WebContents {
    return this.view.webContents
  }

  /** Where the page's top-left corner is inside this window. */
  pageOffset(): { x: number; y: number } {
    const { x, y } = this.view.getBounds()
    return { x, y }
  }

  isUI(wc: WebContents) {
    return wc === this.win.webContents
  }

  private layout() {
    const [w, h] = this.win.getContentSize()
    this.view.setBounds({ x: GAP, y: TOOLBAR, width: Math.max(0, w - GAP * 2), height: Math.max(0, h - TOOLBAR - GAP) })
  }

  state(): LittleState {
    const wc = this.view.webContents
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      spaceName: this.opts.spaceName,
      color: this.opts.color,
      platform: process.platform,
      popup: !!this.opts.popup,
    }
  }

  /** Tell the toolbar what the page is showing. The toolbar asks once when it starts up. */
  send() {
    if (this.win.isDestroyed() || this.win.webContents.isDestroyed()) return
    const state = this.state()
    this.win.setTitle(this.opts.popup ? state.title || state.url : state.title ? `Little Arc — ${state.title}` : 'Little Arc')
    this.win.webContents.send(IPC.littleState, state)
  }

  navigate(input: string) {
    if (this.opts.popup) return // a popup stays on the pages its site sends it to
    const url = resolveInput(input, this.opts.searchEngine())
    if (!url) return
    void this.view.webContents.loadURL(url).catch(() => {})
    this.view.webContents.focus()
  }

  back() {
    this.view.webContents.navigationHistory.goBack()
  }

  forward() {
    this.view.webContents.navigationHistory.goForward()
  }

  reload() {
    this.view.webContents.reload()
  }

  toMain() {
    if (this.opts.popup) return // moving it would cut it off from the page that opened it
    const url = this.view.webContents.getURL()
    if (url) this.opts.onToMain(url)
    this.win.close()
  }
}
