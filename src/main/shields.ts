import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { app, ipcMain, net, type Session } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getDomain } from 'tldts-experimental'
import { isHttpsFailure, isUpgradeable, stripTrackingParams, toHttp, toHttps } from '../shared/privacy'
import type { ShieldsSettings, ShieldsStatus } from '../shared/types'
import createWorker from './shields-worker?nodeWorker'

// Same lists Ghostery ships as "ads and tracking", plus cookie-notice lists.
// These are mirrors of EasyList, EasyPrivacy, uBlock Origin and Peter Lowe's lists.
const LIST_BASE = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets'
const CORE_LISTS = [
  'easylist/easylist.txt',
  'easylist/easyprivacy.txt',
  'peter-lowe/serverlist.txt',
  'ublock-origin/badware.txt',
  'ublock-origin/filters.txt',
  'ublock-origin/filters-2020.txt',
  'ublock-origin/filters-2021.txt',
  'ublock-origin/filters-2022.txt',
  'ublock-origin/filters-2023.txt',
  'ublock-origin/filters-2024.txt',
  'ublock-origin/privacy.txt',
  'ublock-origin/quick-fixes.txt',
  'ublock-origin/resource-abuse.txt',
  'ublock-origin/unbreak.txt',
]
const COOKIE_LISTS = ['easylist/easylist-cookie.txt', 'ublock-origin/annoyances-cookies.txt']
const RESOURCES = 'ublock-origin/resources.json'

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/** Let startup finish before doing heavy work on a slow machine. */
const FIRST_REFRESH_DELAY_MS = 20_000

const COSMETIC_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters'
const MUTATION_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled'

interface CacheMeta {
  updatedAt: number
  listsKey: string
  filterCount?: number
}

/**
 * Brave-style Shields: ad/tracker/cookie-banner blocking (Ghostery's engine
 * with uBlock Origin-compatible lists), tracking-parameter stripping and
 * HTTPS upgrades. Owns the session's webRequest handlers.
 */
export class Shields {
  private engine: ElectronBlocker | null = null
  private status: ShieldsStatus = { ready: false, updating: false }
  private sessions = new Set<Session>()
  /** Hosts we upgraded to https, and when (to detect https→http redirect loops). */
  private upgraded = new Map<string, number>()
  /** Hosts where https failed: always use http this session. */
  private httpOnly = new Set<string>()
  private refreshTimer: NodeJS.Timeout | null = null
  private preloadPath = createRequire(__filename).resolve('@ghostery/adblocker-electron-preload')

  /** Called when the status changes or something was blocked (webContents id). */
  onStatus: () => void = () => {}
  onBlocked: (webContentsId: number) => void = () => {}

  constructor(private getSettings: () => ShieldsSettings) {
    ipcMain.handle(COSMETIC_CHANNEL, (event, url: string, msg?: unknown) => {
      if (!this.engine || !this.activeFor(event.sender.getURL())) return
      return this.engine.onInjectCosmeticFilters(event, url, msg as never)
    })
    ipcMain.handle(MUTATION_CHANNEL, (event) => (this.engine ? this.engine.onIsMutationObserverEnabled(event) : false))
  }

  getStatus(): ShieldsStatus {
    return this.status
  }

  // ───────────────────────────── engine lifecycle ─────────────────────────────

  private dir() {
    return join(app.getPath('userData'), 'Shields')
  }

  private listsKey() {
    return this.getSettings().blockCookieBanners ? 'core+cookies' : 'core'
  }

  /** Load the cached engine (fast), then refresh lists in the background if stale. */
  async init(): Promise<void> {
    await this.loadCached()
    this.scheduleRefresh(FIRST_REFRESH_DELAY_MS)
  }

  private async loadCached(): Promise<boolean> {
    try {
      const meta = JSON.parse(await readFile(join(this.dir(), 'engine.json'), 'utf8')) as CacheMeta
      if (meta.listsKey !== this.listsKey()) return false
      const bytes = await readFile(join(this.dir(), 'engine.bin'))
      this.engine = ElectronBlocker.deserialize(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      this.status = { ready: true, updating: false, updatedAt: meta.updatedAt, filterCount: meta.filterCount }
      this.onStatus()
      return true
    } catch {
      // Missing, corrupt, or written by an older engine version: rebuild.
      return false
    }
  }

  private scheduleRefresh(delay: number) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(async () => {
      const stale = !this.status.updatedAt || Date.now() - this.status.updatedAt > REFRESH_AFTER_MS || !this.engine
      if (stale) await this.refresh()
      this.scheduleRefresh(CHECK_EVERY_MS)
    }, delay)
  }

  /** Download the lists and rebuild the engine on a worker thread. */
  async refresh(): Promise<void> {
    if (this.status.updating) return
    this.status = { ...this.status, updating: true, error: undefined }
    this.onStatus()
    try {
      const names = [...CORE_LISTS, ...(this.getSettings().blockCookieBanners ? COOKIE_LISTS : [])]
      const fetchText = async (path: string) => {
        const res = await net.fetch(`${LIST_BASE}/${path}`, { cache: 'no-cache' })
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
        return res.text()
      }
      const [lists, resources] = await Promise.all([Promise.all(names.map(fetchText)), fetchText(RESOURCES).catch(() => undefined)])

      const { bytes, filterCount } = await new Promise<{ bytes: Uint8Array; filterCount: number }>((resolve, reject) => {
        const worker = createWorker({ workerData: { lists, resources } })
        worker.once('message', resolve)
        worker.once('error', reject)
        worker.once('exit', (code) => code !== 0 && reject(new Error(`filter worker exited with ${code}`)))
      })

      this.engine = ElectronBlocker.deserialize(bytes)
      const meta: CacheMeta = { updatedAt: Date.now(), listsKey: this.listsKey(), filterCount }
      await mkdir(this.dir(), { recursive: true })
      await writeFile(join(this.dir(), 'engine.bin.tmp'), bytes)
      await rename(join(this.dir(), 'engine.bin.tmp'), join(this.dir(), 'engine.bin'))
      await writeFile(join(this.dir(), 'engine.json'), JSON.stringify(meta))
      this.status = { ready: true, updating: false, updatedAt: meta.updatedAt, filterCount }
    } catch (err) {
      console.error('Shields: filter list update failed:', err)
      this.status = { ...this.status, updating: false, error: err instanceof Error ? err.message : String(err) }
    }
    this.onStatus()
  }

  /** Settings changed. Cookie-banner lists are part of the engine, so toggling them rebuilds it. */
  async settingsChanged(prev: ShieldsSettings, next: ShieldsSettings) {
    if (prev.blockCookieBanners !== next.blockCookieBanners) {
      if (!(await this.loadCached())) await this.refresh()
    }
  }

  // ───────────────────────────── per-site state ─────────────────────────────

  static siteOf(url: string): string | null {
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return getDomain(u.hostname) ?? u.hostname
    } catch {
      return null
    }
  }

  // activeFor() runs for every network request, and a page makes hundreds of
  // them with the same top-level URL: remember the answer for the last few pages.
  private siteCache = new Map<string, string | null>()
  private disabledList: string[] | null = null
  private disabledSet = new Set<string>()

  private cachedSite(pageUrl: string): string | null {
    let site = this.siteCache.get(pageUrl)
    if (site === undefined) {
      site = Shields.siteOf(pageUrl)
      if (this.siteCache.size >= 64) this.siteCache.delete(this.siteCache.keys().next().value!)
      this.siteCache.set(pageUrl, site)
    }
    return site
  }

  /** Are Shields active for a page with this top-level URL? */
  activeFor(pageUrl: string | undefined): boolean {
    const s = this.getSettings()
    if (!s.enabled) return false
    if (!pageUrl) return true
    // Never interfere with extension pages (Bitwarden's popup, etc.).
    if (pageUrl.startsWith('chrome-extension://')) return false
    const site = this.cachedSite(pageUrl)
    if (!site) return true
    if (this.disabledList !== s.disabledSites) {
      this.disabledList = s.disabledSites
      this.disabledSet = new Set(s.disabledSites)
    }
    return !this.disabledSet.has(site)
  }

  // ───────────────────────────── HTTPS fallback ─────────────────────────────

  /** A navigation to https://host was our guess (upgrade or typed bare domain). */
  markUpgraded(url: string) {
    try {
      this.upgraded.set(new URL(url).host, Date.now())
    } catch {
      /* ignore */
    }
  }

  /** If an upgraded https load failed, remember the host and return the http URL to load instead. */
  httpFallback(failedUrl: string, errorCode: number): string | null {
    let u: URL
    try {
      u = new URL(failedUrl)
    } catch {
      return null
    }
    if (u.protocol !== 'https:' || !this.upgraded.has(u.host) || !isHttpsFailure(errorCode)) return null
    this.upgraded.delete(u.host)
    this.httpOnly.add(u.host)
    return toHttp(failedUrl)
  }

  // ───────────────────────────── request handling ─────────────────────────────

  attach(ses: Session) {
    if (this.sessions.has(ses)) return
    this.sessions.add(ses)
    ses.registerPreloadScript({ id: 'shields-cosmetics', type: 'frame', filePath: this.preloadPath })

    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (details.resourceType === 'mainFrame') return callback(this.topLevel(details))

      const engine = this.engine
      if (!engine) return callback({})
      const pageUrl = details.webContents?.getURL() || details.referrer
      if (!this.activeFor(pageUrl)) return callback({})
      if (details.referrer.startsWith('chrome-extension://')) return callback({})

      engine.onBeforeRequest(
        // Requests sent with no referrer would otherwise look first-party to the matcher.
        details.referrer ? details : { ...details, referrer: pageUrl ?? '' },
        (response) => {
          if ((response.cancel || response.redirectURL) && details.webContentsId !== undefined) {
            this.onBlocked(details.webContentsId)
          }
          callback(response)
        },
      )
    })

    ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const engine = this.engine
      const pageUrl = details.resourceType === 'mainFrame' ? details.url : details.webContents?.getURL()
      if (!engine || !this.activeFor(pageUrl)) return callback({})
      engine.onHeadersReceived(details, callback)
    })
  }

  /** Top-level navigations: strip tracking parameters and upgrade to https. */
  private topLevel(details: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse {
    if (details.method !== 'GET') return {}
    const s = this.getSettings()
    let url = details.url
    if (s.stripTrackingParams) url = stripTrackingParams(url) ?? url

    if (s.upgradeHttps && isUpgradeable(url)) {
      const host = new URL(url).host
      const last = this.upgraded.get(host)
      if (this.httpOnly.has(host)) {
        // known http-only
      } else if (last && Date.now() - last < 5000) {
        // We upgraded this host moments ago and it sent us back to http: a redirect loop.
        this.httpOnly.add(host)
        this.upgraded.delete(host)
      } else {
        url = toHttps(url)
        this.upgraded.set(host, Date.now())
      }
    }
    return url !== details.url ? { redirectURL: url } : {}
  }
}
