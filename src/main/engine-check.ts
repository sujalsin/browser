import { app, net } from 'electron'
import { engineStatus, type EngineInfo } from '../shared/engine'

/** Where the engine's releases are announced. One anonymous request, no cookies. */
const FEED = 'https://api.github.com/repos/castlabs/electron-releases/releases?per_page=40'
const DAY = 24 * 60 * 60 * 1000

/**
 * Looks once a day for a newer engine. It only reports: updating means
 * rebuilding the app (`npm run engine:update`, see the README).
 */
export class EngineCheck {
  info: EngineInfo = { update: null, nextLine: null, supported: true, checkedAt: null }
  private timer: NodeJS.Timeout | null = null
  private running: Promise<EngineInfo> | null = null

  constructor(
    private readonly enabled: () => boolean,
    private readonly onChange: () => void,
  ) {}

  /** First look once startup has settled, then daily. */
  start(): void {
    setTimeout(() => void this.check(), 90_000).unref()
    this.timer = setInterval(() => void this.check(), DAY)
    this.timer.unref()
  }

  /** `force`: you pressed "Check Now" (works even with the daily check switched off). */
  check(force = false): Promise<EngineInfo> {
    if (!force && !this.enabled()) return Promise.resolve(this.info)
    this.running ??= this.lookUp().finally(() => (this.running = null))
    return this.running
  }

  private async lookUp(): Promise<EngineInfo> {
    try {
      // The automated tests point this at a stand-in; a built app never reads the variable.
      const feed = (!app.isPackaged && process.env.BROWSER_ENGINE_FEED) || FEED
      const res = await net.fetch(feed, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const releases: unknown = await res.json()
      if (!Array.isArray(releases)) throw new Error('unexpected answer')
      const tags = releases.filter((r) => r && typeof r === 'object' && !r.draft && !r.prerelease).map((r) => r.tag_name)
      const before = JSON.stringify(this.info)
      this.info = { ...engineStatus(process.versions.electron, tags), checkedAt: Date.now() }
      if (JSON.stringify({ ...this.info, checkedAt: 0 }) !== JSON.stringify({ ...JSON.parse(before), checkedAt: 0 })) this.onChange()
    } catch (err) {
      // Offline or the service is down: keep what was known and try again tomorrow.
      console.warn('Engine update check failed:', err instanceof Error ? err.message : err)
    }
    return this.info
  }
}
