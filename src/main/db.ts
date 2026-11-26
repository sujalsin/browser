// One SQLite file for history, downloads, site permissions and saved logins
// (whose passwords arrive here already encrypted). Uses Node's
// built-in node:sqlite (bundled with Electron), so there is no native module to
// build for Intel vs Apple Silicon. No Electron imports: unit-tested directly.
import { DatabaseSync } from 'node:sqlite'
import type { DownloadInfo, HistoryItem, LoginInfo, SitePermission } from '../shared/types'

const DAY = 86_400_000

export class BrowserDB {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version < 1) this.createV1()
    if (version < 2) this.createV2()
  }

  /** Saved logins. `secret` is the password as encrypted by the caller; this file never sees it in the clear. */
  private createV2() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logins (
        id INTEGER PRIMARY KEY,
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        secret BLOB NOT NULL,
        created INTEGER NOT NULL,
        used INTEGER NOT NULL,
        UNIQUE (origin, username)
      );
      CREATE TABLE IF NOT EXISTS logins_never (origin TEXT PRIMARY KEY);
      PRAGMA user_version = 2;
    `)
  }

  private createV1() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        favicon TEXT,
        visit_count INTEGER NOT NULL DEFAULT 0,
        last_visit INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS urls_last_visit ON urls(last_visit);
      CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY,
        url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
        time INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS visits_time ON visits(time);
      CREATE INDEX IF NOT EXISTS visits_url ON visits(url_id);

      -- Full-text index over titles and URLs, kept in sync by triggers.
      CREATE VIRTUAL TABLE IF NOT EXISTS urls_fts USING fts5(title, url, content='urls', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS urls_ai AFTER INSERT ON urls BEGIN
        INSERT INTO urls_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
      END;
      CREATE TRIGGER IF NOT EXISTS urls_ad AFTER DELETE ON urls BEGIN
        INSERT INTO urls_fts(urls_fts, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
      END;
      CREATE TRIGGER IF NOT EXISTS urls_au AFTER UPDATE OF title, url ON urls BEGIN
        INSERT INTO urls_fts(urls_fts, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
        INSERT INTO urls_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
      END;

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        started INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permissions (
        partition TEXT NOT NULL,
        origin TEXT NOT NULL,
        permission TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (partition, origin, permission)
      );
      PRAGMA user_version = 1;
    `)
  }

  close() {
    this.db.close()
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ───────────────────────────── history ─────────────────────────────

  /** Record a page visit. Repeats within a second (redirects, reloads) count once. */
  addVisit(url: string, title: string, time = Date.now()) {
    const row = this.db.prepare('SELECT id, last_visit FROM urls WHERE url = ?').get(url) as { id: number; last_visit: number } | undefined
    if (row && Math.abs(time - row.last_visit) < 1000) return
    this.tx(() => {
      let id = row?.id
      if (id === undefined) {
        id = Number(this.db.prepare('INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)').run(url, title, time).lastInsertRowid)
      } else {
        this.db
          .prepare("UPDATE urls SET visit_count = visit_count + 1, last_visit = MAX(last_visit, ?), title = CASE WHEN ? != '' THEN ? ELSE title END WHERE id = ?")
          .run(time, title, title, id)
      }
      this.db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)').run(id, time)
    })
  }

  setTitle(url: string, title: string) {
    if (title) this.db.prepare('UPDATE urls SET title = ? WHERE url = ? AND title != ?').run(title, url, title)
  }

  setFavicon(url: string, favicon: string) {
    this.db.prepare('UPDATE urls SET favicon = ? WHERE url = ?').run(favicon, url)
  }

  /** FTS5 query matching every word as a prefix, or null if the input has no words. */
  private static ftsQuery(input: string): string | null {
    const words = input.toLowerCase().match(/[\p{L}\p{N}]+/gu)
    return words?.length ? words.map((w) => `"${w}"*`).join(' ') : null
  }

  /**
   * Suggestions for the command bar: pages matching every word, ranked by
   * "frecency" (visits, decayed by age), with a boost when the host itself
   * starts with what was typed.
   */
  suggest(input: string, limit = 6, now = Date.now()): HistoryItem[] {
    const fts = BrowserDB.ftsQuery(input)
    if (!fts) return []
    const rows = this.db
      .prepare(
        `SELECT u.url, u.title, u.favicon, u.visit_count AS visitCount, u.last_visit AS lastVisit
         FROM urls_fts f JOIN urls u ON u.id = f.rowid
         WHERE urls_fts MATCH ? ORDER BY u.last_visit DESC LIMIT 200`,
      )
      .all(fts) as unknown as HistoryItem[]
    const typed = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
    const score = (r: HistoryItem) => {
      const ageWeeks = Math.max(0, now - r.lastVisit) / (7 * DAY)
      let s = r.visitCount / (1 + ageWeeks)
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, '')
        if (host.startsWith(typed)) s *= 4
        if (new URL(r.url).pathname === '/' && host.startsWith(typed)) s *= 2
      } catch {
        /* ignore */
      }
      return s
    }
    return rows
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.r)
  }

  /** History page: visits, newest first, optionally filtered by search text. */
  listVisits(opts: { query?: string; before?: number; limit?: number } = {}): (HistoryItem & { visitId: number; time: number })[] {
    const limit = Math.min(opts.limit ?? 200, 1000)
    const before = opts.before ?? Number.MAX_SAFE_INTEGER
    const fts = opts.query ? BrowserDB.ftsQuery(opts.query) : null
    if (opts.query && !fts) return []
    const sql = `SELECT v.id AS visitId, v.time, u.url, u.title, u.favicon, u.visit_count AS visitCount, u.last_visit AS lastVisit
      FROM visits v JOIN urls u ON u.id = v.url_id
      WHERE v.time < ? ${fts ? 'AND v.url_id IN (SELECT rowid FROM urls_fts WHERE urls_fts MATCH ?)' : ''}
      ORDER BY v.time DESC LIMIT ?`
    const params: (string | number)[] = fts ? [before, fts, limit] : [before, limit]
    return this.db.prepare(sql).all(...params) as unknown as (HistoryItem & { visitId: number; time: number })[]
  }

  /** Forget a page entirely (all its visits). */
  deleteUrl(url: string) {
    this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
  }

  /** Delete visits at or after `since` (0 = all history). */
  deleteSince(since: number) {
    this.deleteVisits('time >= ?', since)
  }

  /** Drop visits older than `cutoff` (history retention). */
  prune(cutoff: number) {
    this.deleteVisits('time < ?', cutoff)
  }

  /**
   * Delete visits and fix up only the pages they belonged to, so pruning a
   * few old visits doesn't rescan the whole history on the main thread.
   */
  private deleteVisits(where: string, value: number) {
    this.tx(() => {
      this.db.exec('CREATE TEMP TABLE IF NOT EXISTS touched (id INTEGER PRIMARY KEY); DELETE FROM touched;')
      this.db.prepare(`INSERT OR IGNORE INTO touched SELECT DISTINCT url_id FROM visits WHERE ${where}`).run(value)
      this.db.prepare(`DELETE FROM visits WHERE ${where}`).run(value)
      this.db.exec(`
        DELETE FROM urls WHERE id IN (SELECT id FROM touched) AND id NOT IN (SELECT url_id FROM visits WHERE url_id IN (SELECT id FROM touched));
        UPDATE urls SET
          visit_count = (SELECT COUNT(*) FROM visits WHERE url_id = urls.id),
          last_visit = (SELECT MAX(time) FROM visits WHERE url_id = urls.id)
        WHERE id IN (SELECT id FROM touched);
        DELETE FROM touched;
      `)
    })
  }

  /** Bulk import (from Arc): keeps the higher visit count and newer date. */
  importUrls(rows: { url: string; title: string; visitCount: number; lastVisit: number }[]): number {
    let added = 0
    this.tx(() => {
      const find = this.db.prepare('SELECT id FROM urls WHERE url = ?')
      const insert = this.db.prepare('INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, ?, ?)')
      const update = this.db.prepare(
        'UPDATE urls SET visit_count = MAX(visit_count, ?), last_visit = MAX(last_visit, ?), title = CASE WHEN title = \'\' THEN ? ELSE title END WHERE id = ?',
      )
      const visit = this.db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)')
      for (const r of rows) {
        const existing = find.get(r.url) as { id: number } | undefined
        if (existing) {
          update.run(r.visitCount, r.lastVisit, r.title, existing.id)
        } else {
          const id = Number(insert.run(r.url, r.title, Math.max(1, r.visitCount), r.lastVisit).lastInsertRowid)
          visit.run(id, r.lastVisit)
          added++
        }
      }
    })
    return added
  }

  historyCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM urls').get() as { n: number }).n
  }

  // ───────────────────────────── downloads ─────────────────────────────

  saveDownload(info: DownloadInfo) {
    this.db
      .prepare('INSERT INTO downloads (id, started, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(info.id, info.startedAt, JSON.stringify(info))
  }

  listDownloads(limit = 100): DownloadInfo[] {
    const rows = this.db.prepare('SELECT data FROM downloads ORDER BY started DESC LIMIT ?').all(limit) as { data: string }[]
    return rows.map((r) => JSON.parse(r.data) as DownloadInfo)
  }

  deleteDownload(id: string) {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
  }

  // ───────────────────────────── site permissions ─────────────────────────────

  listPermissions(): SitePermission[] {
    return this.db
      .prepare('SELECT partition, origin, permission, allowed, updated FROM permissions ORDER BY origin, permission')
      .all()
      .map((r) => {
        const row = r as { partition: string; origin: string; permission: string; allowed: number; updated: number }
        return { ...row, allowed: row.allowed === 1 }
      })
  }

  setPermission(p: SitePermission) {
    this.db
      .prepare(
        'INSERT INTO permissions (partition, origin, permission, allowed, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(partition, origin, permission) DO UPDATE SET allowed = excluded.allowed, updated = excluded.updated',
      )
      .run(p.partition, p.origin, p.permission, p.allowed ? 1 : 0, p.updated)
  }

  deletePermission(partition: string, origin: string, permission: string) {
    this.db.prepare('DELETE FROM permissions WHERE partition = ? AND origin = ? AND permission = ?').run(partition, origin, permission)
  }

  // ───────────────────────────── saved logins ─────────────────────────────

  /** Add a login, or replace the password of the one already saved for this site and user name. Returns its id. */
  saveLogin(origin: string, username: string, secret: Uint8Array, now = Date.now()): number {
    const row = this.db
      .prepare(
        `INSERT INTO logins (origin, username, secret, created, used) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (origin, username) DO UPDATE SET secret = excluded.secret, used = excluded.used
         RETURNING id`,
      )
      .get(origin, username, secret, now, now) as { id: number }
    return row.id
  }

  /** Logins saved for a site, most recently used first. Without the passwords. */
  loginsFor(origin: string): LoginInfo[] {
    return this.db.prepare('SELECT id, origin, username, used FROM logins WHERE origin = ? ORDER BY used DESC, id DESC').all(origin) as unknown as LoginInfo[]
  }

  /** Every saved login, by site. Without the passwords. */
  listLogins(): LoginInfo[] {
    return this.db.prepare('SELECT id, origin, username, used FROM logins ORDER BY origin, username').all() as unknown as LoginInfo[]
  }

  /** The encrypted password of one login. */
  loginSecret(id: number): Uint8Array | null {
    const row = this.db.prepare('SELECT secret FROM logins WHERE id = ?').get(id) as { secret: Uint8Array } | undefined
    return row?.secret ?? null
  }

  touchLogin(id: number, now = Date.now()) {
    this.db.prepare('UPDATE logins SET used = ? WHERE id = ?').run(now, id)
  }

  deleteLogin(id: number) {
    this.db.prepare('DELETE FROM logins WHERE id = ?').run(id)
  }

  /** "Never for this site": don't offer to save passwords there again. */
  setNeverSave(origin: string, never: boolean) {
    if (never) this.db.prepare('INSERT OR IGNORE INTO logins_never (origin) VALUES (?)').run(origin)
    else this.db.prepare('DELETE FROM logins_never WHERE origin = ?').run(origin)
  }

  isNeverSave(origin: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM logins_never WHERE origin = ?').get(origin)
  }

  listNeverSave(): string[] {
    return (this.db.prepare('SELECT origin FROM logins_never ORDER BY origin').all() as { origin: string }[]).map((r) => r.origin)
  }
}
