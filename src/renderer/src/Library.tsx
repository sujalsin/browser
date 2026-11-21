import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { normalizeDomain } from '../../shared/boosts'
import { SPACE_COLORS } from '../../shared/constants'
import { LANGUAGES } from '../../shared/translate'
import type { AppInfo, Boost, DownloadInfo, HistoryItem, LibraryTab, SearchEngineId, SitePermission, TaskInfo, UIState } from '../../shared/types'
import { SEARCH_ENGINES, displayHost } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon, type IconName } from './Icon'
import { dispatch } from './useBrowserState'

const TABS: { id: LibraryTab; label: string; icon: IconName; key: string }[] = [
  { id: 'history', label: 'History', icon: 'history', key: '⌘Y' },
  { id: 'downloads', label: 'Downloads', icon: 'download', key: '⇧⌘J' },
  { id: 'boosts', label: 'Boosts', icon: 'boost', key: '' },
  { id: 'tasks', label: 'Task Manager', icon: 'tasks', key: '' },
  { id: 'settings', label: 'Settings', icon: 'settings', key: '⌘,' },
]

/** History, Downloads and Settings in one panel over the window. */
export function Library({ state }: { state: UIState }) {
  const tab = state.library!.tab
  const close = () => dispatch({ type: 'library.close' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="overlay-backdrop library-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="library" role="dialog" aria-label="Library">
        <nav className="library-nav">
          {TABS.map((t) => (
            <button key={t.id} className={`library-nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => dispatch({ type: 'library.open', tab: t.id })}>
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
              {t.id === 'downloads' && state.downloads.some((d) => d.state === 'progressing') && <span className="nav-dot" />}
              {t.key && <kbd className="nav-key">{t.key}</kbd>}
            </button>
          ))}
        </nav>
        <section className="library-body">
          <button className="icon-btn library-close" title="Close (Esc)" onClick={close}>
            <Icon name="close" size={14} />
          </button>
          {tab === 'history' && <HistoryView />}
          {tab === 'downloads' && <DownloadsView state={state} />}
          {tab === 'boosts' && <BoostsView state={state} />}
          {tab === 'tasks' && <TasksView state={state} />}
          {tab === 'settings' && <SettingsView state={state} />}
        </section>
      </div>
    </div>
  )
}

// ───────────────────────────── History ─────────────────────────────

type Visit = HistoryItem & { visitId: number; time: number }

function dayLabel(time: number) {
  const d = new Date(time)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function HistoryView() {
  const [query, setQuery] = useState('')
  const [visits, setVisits] = useState<Visit[]>([])
  const [more, setMore] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async (q: string, before?: number) => {
    const rows = (await window.browser.query<Visit[]>({ type: 'history.list', query: q || undefined, before })) ?? []
    setVisits((prev) => (before ? [...prev, ...rows] : rows))
    setMore(rows.length >= 200)
  }, [])

  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? 120 : 0)
    return () => clearTimeout(t)
  }, [query, load])

  const clear = (label: string, since: number) => {
    if (!window.confirm(`Clear browsing history from ${label}?`)) return
    dispatch({ type: 'history.clear', since })
    void load(query)
  }
  const now = Date.now()
  const midnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime()

  const groups: { label: string; items: Visit[] }[] = []
  for (const v of visits) {
    const label = dayLabel(v.time)
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] })
    groups[groups.length - 1].items.push(v)
  }

  return (
    <div className="lib-page">
      <header className="lib-header">
        <h2>History</h2>
        <div className="lib-search">
          <Icon name="search" size={14} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search history" spellCheck={false} />
        </div>
        <select
          className="lib-select"
          value=""
          onChange={(e) => {
            const v = e.target.value
            e.target.value = ''
            if (v === 'hour') clear('the last hour', now - 3_600_000)
            else if (v === 'today') clear('today', midnight)
            else if (v === 'week') clear('the last 7 days', now - 7 * 86_400_000)
            else if (v === 'all') clear('all time', 0)
          }}
        >
          <option value="" disabled>
            Clear History…
          </option>
          <option value="hour">Last hour</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="all">All time</option>
        </select>
      </header>
      <div className="lib-scroll">
        {visits.length === 0 && <p className="lib-empty">{query ? 'No matching pages.' : 'Pages you visit will show up here.'}</p>}
        {groups.map((g) => (
          <div key={g.label + g.items[0].visitId} className="lib-group">
            <h3>{g.label}</h3>
            <ul className="lib-list">
              {g.items.map((v) => (
                <li
                  key={v.visitId}
                  className="lib-row clickable"
                  title={v.url}
                  onClick={() => {
                    dispatch({ type: 'library.close' })
                    dispatch({ type: 'tab.open', input: v.url, mode: 'new' })
                  }}
                >
                  <span className="lib-time">{new Date(v.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  <Favicon src={v.favicon ?? undefined} url={v.url} />
                  <span className="lib-title">{v.title || displayHost(v.url)}</span>
                  <span className="lib-host">{displayHost(v.url)}</span>
                  <button
                    className="icon-btn row-action"
                    title="Remove from history"
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch({ type: 'history.delete', url: v.url })
                      setVisits((prev) => prev.filter((x) => x.url !== v.url))
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {more && (
          <button className="lib-button more" onClick={() => void load(query, visits[visits.length - 1]?.time)}>
            Show more
          </button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── Downloads ─────────────────────────────

function formatBytes(n: number) {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${units[i]}`
}

type DownloadOp = Extract<Parameters<typeof dispatch>[0], { type: 'download.act' }>['op']

function downloadStatus(d: DownloadInfo) {
  switch (d.state) {
    case 'progressing':
      return d.paused
        ? `Paused — ${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}`
        : `${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}`
    case 'completed':
      return `${formatBytes(d.received)} · ${displayHost(d.url)}`
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return 'Failed'
  }
}

function DownloadsView({ state }: { state: UIState }) {
  const finder = state.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder'
  const act = (id: string, op: DownloadOp) => dispatch({ type: 'download.act', id, op })
  return (
    <div className="lib-page">
      <header className="lib-header">
        <h2>Downloads</h2>
        <span className="spacer" />
        {state.downloads.some((d) => d.state !== 'progressing') && (
          <button className="lib-button" onClick={() => dispatch({ type: 'downloads.clear' })}>
            Clear List
          </button>
        )}
      </header>
      <div className="lib-scroll">
        {state.downloads.length === 0 && <p className="lib-empty">Files you download will show up here. They're saved to your Downloads folder.</p>}
        <ul className="lib-list">
          {state.downloads.map((d) => {
            const pct = d.total ? Math.round((d.received / d.total) * 100) : 0
            const done = d.state === 'completed'
            return (
              <li key={d.id} className={`lib-row download ${done ? 'clickable' : ''}`} onDoubleClick={() => done && act(d.id, 'open')}>
                <span className="file-badge">{(d.filename.split('.').pop() ?? '').slice(0, 4).toUpperCase() || 'FILE'}</span>
                <div className="download-main">
                  <span className={`lib-title ${d.state === 'cancelled' || d.state === 'interrupted' ? 'struck' : ''}`}>{d.filename}</span>
                  {d.state === 'progressing' && (
                    <div className="progress">
                      <div className="progress-fill" style={{ width: `${d.total ? pct : 30}%` }} />
                    </div>
                  )}
                  <span className="lib-sub">{downloadStatus(d)}</span>
                </div>
                <div className="download-actions">
                  {d.state === 'progressing' && (
                    <>
                      <button className="icon-btn" title={d.paused ? 'Resume' : 'Pause'} onClick={() => act(d.id, d.paused ? 'resume' : 'pause')}>
                        <Icon name={d.paused ? 'play' : 'pause'} size={13} />
                      </button>
                      <button className="icon-btn" title="Cancel" onClick={() => act(d.id, 'cancel')}>
                        <Icon name="close" size={13} />
                      </button>
                    </>
                  )}
                  {done && (
                    <>
                      <button className="lib-button small" onClick={() => act(d.id, 'open')}>
                        Open
                      </button>
                      <button className="icon-btn" title={finder} onClick={() => act(d.id, 'show')}>
                        <Icon name="folderOpen" size={14} />
                      </button>
                    </>
                  )}
                  {d.state === 'interrupted' && (
                    <button className="lib-button small" onClick={() => act(d.id, 'retry')}>
                      Retry
                    </button>
                  )}
                  {d.state !== 'progressing' && (
                    <button className="icon-btn" title="Remove from list" onClick={() => act(d.id, 'remove')}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ───────────────────────────── Settings ─────────────────────────────

const PERMISSION_NAMES: Record<string, string> = {
  media: 'Camera & microphone',
  geolocation: 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  'display-capture': 'Screen recording',
  midi: 'MIDI devices',
  midiSysex: 'MIDI devices',
  'idle-detection': 'Idle detection',
  'storage-access': 'Cross-site cookies',
  'top-level-storage-access': 'Cross-site cookies',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h3>{title}</h3>
      <div className="set-card">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

function SettingsView({ state }: { state: UIState }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [perms, setPerms] = useState<SitePermission[]>([])
  const refresh = useCallback(() => {
    void window.browser.query<AppInfo>({ type: 'app.info' }).then(setInfo)
    void window.browser.query<SitePermission[]>({ type: 'permissions.list' }).then((p) => setPerms(p ?? []))
  }, [])
  useEffect(refresh, [refresh])

  const s = state.settings
  const sh = state.shields
  const profileName = (partition: string) =>
    state.spaces
      .filter((sp) => sp.partition === partition)
      .map((sp) => sp.name)
      .join(', ') || 'Deleted space'
  const status = state.shieldsStatus

  return (
    <div className="lib-page">
      <header className="lib-header">
        <h2>Settings</h2>
      </header>
      <div className="lib-scroll settings">
        <Section title="General">
          <Row label="Search engine">
            <select
              className="lib-select"
              value={state.searchEngine}
              onChange={(e) => dispatch({ type: 'searchEngine.set', id: e.target.value as SearchEngineId })}
            >
              {Object.entries(SEARCH_ENGINES).map(([id, e]) => (
                <option key={id} value={id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Translate pages to" hint="View → Translate Page (⌥⌘T). The page’s text is sent to Google Translate only when you ask.">
            <select className="lib-select" value={s.translateTo} onChange={(e) => dispatch({ type: 'settings.update', patch: { translateTo: e.target.value } })}>
              {Object.entries(LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Default browser" hint={info?.isDefaultBrowser ? 'Links from other apps open here.' : 'Links from other apps open in another browser.'}>
            {info?.isDefaultBrowser ? (
              <span className="set-ok">✓ Default</span>
            ) : (
              <button
                className="lib-button"
                onClick={() => {
                  dispatch({ type: 'browser.makeDefault' })
                  setTimeout(refresh, 1500)
                }}
              >
                Make Default
              </button>
            )}
          </Row>
          <Row label="Import from Arc" hint={info?.arcFound ? 'Spaces, pinned tabs, folders, favorites and history.' : "Arc's data wasn't found; you can pick the file."}>
            <button className="lib-button" onClick={() => dispatch({ type: 'arc.import' })}>
              Import…
            </button>
          </Row>
        </Section>

        <Section title="Appearance">
          <Row label="Appearance" hint="Also applies to websites that have a dark mode.">
            <select
              className="lib-select"
              value={s.appearance}
              onChange={(e) => dispatch({ type: 'settings.update', patch: { appearance: e.target.value as 'system' | 'light' | 'dark' } })}
            >
              <option value="system">Match System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>
          {state.spaces.map((sp) => (
            <div key={sp.id} className="set-row space-theme">
              <div className="set-label">
                <span>{sp.name}</span>
                <small>{sp.gradient ? 'Gradient' : 'Color'}</small>
              </div>
              <div className="swatches">
                {SPACE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    className={`swatch ${sp.color === c.value ? 'on' : ''}`}
                    title={c.name}
                    style={{ background: c.value }}
                    onClick={() => dispatch({ type: 'space.update', id: sp.id, color: c.value })}
                  />
                ))}
              </div>
              <input
                type="color"
                className="color-input"
                title="Custom color"
                value={sp.color}
                onChange={(e) => dispatch({ type: 'space.update', id: sp.id, color: e.target.value })}
              />
              {sp.gradient ? (
                <>
                  <input
                    type="color"
                    className="color-input"
                    title="Gradient color"
                    value={sp.gradient}
                    onChange={(e) => dispatch({ type: 'space.update', id: sp.id, gradient: e.target.value })}
                  />
                  <button className="lib-button small" onClick={() => dispatch({ type: 'space.update', id: sp.id, gradient: null })}>
                    Solid
                  </button>
                </>
              ) : (
                <button
                  className="lib-button small"
                  onClick={() => dispatch({ type: 'space.update', id: sp.id, gradient: SPACE_COLORS[(SPACE_COLORS.findIndex((c) => c.value === sp.color) + 2) % SPACE_COLORS.length].value })}
                >
                  Gradient
                </button>
              )}
            </div>
          ))}
          <Row label="Open links from pinned tabs in Peek" hint="Links that would open a new tab show in a preview instead, like Arc.">
            <Toggle label="Peek from pinned tabs" on={s.peekFromPinned} onChange={(v) => dispatch({ type: 'settings.update', patch: { peekFromPinned: v } })} />
          </Row>
          <Row label="Open links from other apps in Little Arc" hint="A small window you can move into the browser with one click.">
            <Toggle label="Little Arc for links" on={s.littleArcForLinks} onChange={(v) => dispatch({ type: 'settings.update', patch: { littleArcForLinks: v } })} />
          </Row>
        </Section>

        <Section title="Tabs & Performance">
          <Row label="Archive Today tabs" hint="Unused Today tabs move to the archive, like Arc.">
            <select className="lib-select" value={s.archiveAfterHours} onChange={(e) => dispatch({ type: 'settings.update', patch: { archiveAfterHours: Number(e.target.value) } })}>
              <option value={12}>After 12 hours</option>
              <option value={24}>After 24 hours</option>
              <option value={168}>After 7 days</option>
              <option value={720}>After 30 days</option>
              <option value={0}>Never</option>
            </select>
          </Row>
          <Row label="Put inactive tabs to sleep" hint="Frees memory and CPU; tabs reload when you open them.">
            <select className="lib-select" value={s.sleepAfterMinutes} onChange={(e) => dispatch({ type: 'settings.update', patch: { sleepAfterMinutes: Number(e.target.value) } })}>
              <option value={5}>After 5 minutes</option>
              <option value={15}>After 15 minutes</option>
              <option value={30}>After 30 minutes</option>
              <option value={60}>After 1 hour</option>
              <option value={0}>Never</option>
            </select>
          </Row>
          <Row label="Prefer H.264 video" hint="Much less CPU on Intel Macs; YouTube tops out at 1080p.">
            <Toggle label="Prefer H.264 video" on={s.preferH264} onChange={(v) => dispatch({ type: 'settings.update', patch: { preferH264: v } })} />
          </Row>
        </Section>

        <Section title="Shields">
          <Row
            label="Block ads and trackers"
            hint={status.ready ? `${(status.filterCount ?? 0).toLocaleString()} filter rules${status.updatedAt ? `, updated ${new Date(status.updatedAt).toLocaleDateString()}` : ''}` : 'Downloading filter lists…'}
          >
            <Toggle label="Block ads and trackers" on={sh.enabled} onChange={(v) => dispatch({ type: 'shields.update', patch: { enabled: v } })} />
          </Row>
          <Row label="Block cookie banners">
            <Toggle label="Block cookie banners" on={sh.blockCookieBanners} onChange={(v) => dispatch({ type: 'shields.update', patch: { blockCookieBanners: v } })} />
          </Row>
          <Row label="Upgrade connections to HTTPS">
            <Toggle label="Upgrade to HTTPS" on={sh.upgradeHttps} onChange={(v) => dispatch({ type: 'shields.update', patch: { upgradeHttps: v } })} />
          </Row>
          <Row label="Remove tracking parameters" hint="fbclid, gclid and similar, from links you open.">
            <Toggle label="Remove tracking parameters" on={sh.stripTrackingParams} onChange={(v) => dispatch({ type: 'shields.update', patch: { stripTrackingParams: v } })} />
          </Row>
          {sh.disabledSites.length > 0 && (
            <div className="set-list">
              <div className="set-list-title">Shields are off on these sites</div>
              {sh.disabledSites.map((site) => (
                <div key={site} className="set-list-row">
                  <span>{site}</span>
                  <button className="lib-button small" onClick={() => dispatch({ type: 'shields.update', patch: { disabledSites: sh.disabledSites.filter((d) => d !== site) } })}>
                    Turn On
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Site Permissions">
          {perms.length === 0 ? (
            <p className="set-note">When a site asks for your camera, location, notifications and so on, your answer is remembered here.</p>
          ) : (
            <div className="set-list">
              {perms.map((p) => (
                <div key={`${p.partition}|${p.origin}|${p.permission}`} className="set-list-row">
                  <span className="perm-site">{displayHost(p.origin)}</span>
                  <span className="perm-what">{PERMISSION_NAMES[p.permission] ?? p.permission}</span>
                  <span className={`perm-state ${p.allowed ? 'allowed' : 'blocked'}`}>{p.allowed ? 'Allowed' : 'Blocked'}</span>
                  {new Set(state.spaces.map((sp) => sp.partition)).size > 1 && <span className="perm-profile">{profileName(p.partition)}</span>}
                  <button
                    className="lib-button small"
                    onClick={() => {
                      dispatch({ type: 'permissions.forget', partition: p.partition, origin: p.origin, permission: p.permission })
                      setPerms((prev) => prev.filter((x) => x !== p))
                    }}
                  >
                    Reset
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Privacy">
          <Row label="Clear cached files" hint="Images and files saved to load sites faster.">
            <button className="lib-button" onClick={() => dispatch({ type: 'data.clear', what: 'cache' })}>
              Clear Cache…
            </button>
          </Row>
          <Row label="Clear cookies" hint="Signs you out of websites. Bitwarden keeps its data.">
            <button className="lib-button" onClick={() => dispatch({ type: 'data.clear', what: 'cookies' })}>
              Clear Cookies…
            </button>
          </Row>
          <Row label="History" hint={info ? `${info.historyCount.toLocaleString()} pages · kept for 90 days` : undefined}>
            <button className="lib-button" onClick={() => dispatch({ type: 'library.open', tab: 'history' })}>
              Open History
            </button>
          </Row>
        </Section>

        {info && (
          <p className="set-about">
            Browser {info.version} · Chromium {info.chrome} · Electron {info.electron} ·{' '}
            {info.widevine ? `Protected video (Widevine ${info.widevine}) ready` : 'Protected video (Netflix, Spotify) not available yet'}
          </p>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── Boosts ─────────────────────────────

function BoostsView({ state }: { state: UIState }) {
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const [selected, setSelected] = useState<string | null>(state.boosts[0]?.id ?? null)
  const [newDomain, setNewDomain] = useState(() => normalizeDomain(active?.url ?? '') ?? '')
  const boost = state.boosts.find((b) => b.id === selected) ?? null

  // A Boost just created from the form: select it once it arrives.
  const pending = useRef<string | null>(null)
  useEffect(() => {
    if (!pending.current) return
    const made = state.boosts.find((b) => b.domain === pending.current)
    if (made) {
      setSelected(made.id)
      pending.current = null
    }
  }, [state.boosts])

  const create = () => {
    const domain = normalizeDomain(newDomain)
    if (!domain) return
    const existing = state.boosts.find((b) => b.domain === domain)
    if (existing) return setSelected(existing.id)
    pending.current = domain
    dispatch({ type: 'boost.save', boost: { id: '', domain, enabled: true, css: '', js: '', updated: 0 } })
  }

  return (
    <div className="lib-page">
      <header className="lib-header">
        <h2>Boosts</h2>
        <div className="lib-search">
          <Icon name="boost" size={14} />
          <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Site, e.g. youtube.com" spellCheck={false} />
        </div>
        <button className="lib-button" disabled={!normalizeDomain(newDomain)} onClick={create}>
          New Boost
        </button>
      </header>
      <div className="boosts">
        <ul className="boost-list">
          {state.boosts.length === 0 && (
            <li className="lib-empty small">
              Boosts restyle a site with your own CSS (and optional JavaScript). Right-click anything on a page → <b>Hide This Element</b> to start one.
            </li>
          )}
          {state.boosts.map((b) => (
            <li key={b.id} className={`boost-item ${b.id === selected ? 'active' : ''}`} onClick={() => setSelected(b.id)}>
              <span className={`boost-dot ${b.enabled ? 'on' : ''}`} />
              <span className="lib-title">{b.domain}</span>
            </li>
          ))}
        </ul>
        {boost ? <BoostEditor key={boost.id + boost.updated} boost={boost} /> : <div className="boost-editor empty" />}
      </div>
    </div>
  )
}

function BoostEditor({ boost }: { boost: Boost }) {
  const [css, setCss] = useState(boost.css)
  const [js, setJs] = useState(boost.js)
  const dirty = css !== boost.css || js !== boost.js
  const save = (patch: Partial<Boost> = {}) => dispatch({ type: 'boost.save', boost: { ...boost, css, js, ...patch } })
  return (
    <div className="boost-editor">
      <div className="boost-head">
        <span className="boost-domain">{boost.domain}</span>
        <span className="set-label small">and its subdomains</span>
        <span className="spacer" />
        <Toggle label="Boost enabled" on={boost.enabled} onChange={(v) => save({ enabled: v })} />
      </div>
      <label className="boost-label">CSS</label>
      <textarea
        className="code"
        value={css}
        spellCheck={false}
        placeholder={'/* e.g. hide YouTube Shorts */\nytd-reel-shelf-renderer { display: none !important; }'}
        onChange={(e) => setCss(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 's' && (e.preventDefault(), save())}
      />
      <label className="boost-label">
        JavaScript <small>runs on every page load of this site — only paste code you understand</small>
      </label>
      <textarea className="code js" value={js} spellCheck={false} placeholder="// optional" onChange={(e) => setJs(e.target.value)} />
      <div className="boost-actions">
        <button
          className="lib-button"
          onClick={() => {
            if (window.confirm(`Delete the Boost for ${boost.domain}?`)) dispatch({ type: 'boost.delete', id: boost.id })
          }}
        >
          Delete
        </button>
        <span className="spacer" />
        {dirty && <span className="set-label small">Unsaved · ⌘S</span>}
        <button className="lib-button primary" disabled={!dirty} onClick={() => save()}>
          Save
        </button>
      </div>
    </div>
  )
}

// ───────────────────────────── Task Manager ─────────────────────────────

function TasksView({ state }: { state: UIState }) {
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  useEffect(() => {
    let alive = true
    const load = () => void window.browser.query<TaskInfo[]>({ type: 'tasks.list' }).then((t) => alive && setTasks(t ?? []))
    load()
    const timer = setInterval(load, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  const total = tasks.reduce((n, t) => n + t.memoryMB, 0)
  const asleep = state.tabs.filter((t) => !state.runtime[t.id]).length
  const fmt = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`)
  return (
    <div className="lib-page">
      <header className="lib-header">
        <h2>Task Manager</h2>
        <span className="set-label small">
          {fmt(total)} in use · {tasks.filter((t) => t.kind === 'tab').length} tabs loaded, {asleep} asleep
        </span>
      </header>
      <div className="lib-scroll">
        <ul className="lib-list tasks">
          <li className="lib-row task-head">
            <span className="lib-title">Task</span>
            <span className="task-num">Memory</span>
            <span className="task-num">CPU</span>
            <span className="task-actions" />
          </li>
          {tasks.map((t) => (
            <li key={t.pid} className="lib-row">
              <span className={`task-kind ${t.kind}`} />
              <span className="lib-title">{t.title}</span>
              <span className="task-num">{fmt(t.memoryMB)}</span>
              <span className={`task-num ${t.cpu > 50 ? 'hot' : ''}`}>{t.cpu.toFixed(1)}%</span>
              <span className="task-actions">
                {t.tabId && t.canSleep && (
                  <button
                    className="lib-button small"
                    title="Free this tab's memory; it reloads when you open it"
                    onClick={() => {
                      dispatch({ type: 'tab.sleep', id: t.tabId! })
                      setTasks((prev) => prev.filter((x) => x.pid !== t.pid))
                    }}
                  >
                    Sleep
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
