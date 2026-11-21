import { describe, expect, it } from 'vitest'
import { BrowserDB } from './db'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function db() {
  return new BrowserDB(':memory:')
}

describe('history', () => {
  it('records visits and counts repeat visits', () => {
    const h = db()
    h.addVisit('https://github.com/', 'GitHub', NOW - 10_000)
    h.addVisit('https://github.com/', '', NOW)
    const [item] = h.suggest('git', 5, NOW)
    expect(item).toMatchObject({ url: 'https://github.com/', title: 'GitHub', visitCount: 2, lastVisit: NOW })
  })

  it('ignores repeats within a second (redirects, reloads)', () => {
    const h = db()
    h.addVisit('https://a.com/', 'A', NOW)
    h.addVisit('https://a.com/', 'A', NOW + 300)
    expect(h.listVisits()).toHaveLength(1)
  })

  it('matches words in titles and URLs as prefixes, all words required', () => {
    const h = db()
    h.addVisit('https://news.ycombinator.com/', 'Hacker News', NOW)
    h.addVisit('https://www.nytimes.com/', 'The New York Times', NOW)
    expect(h.suggest('hack new', 5, NOW).map((r) => r.url)).toEqual(['https://news.ycombinator.com/'])
    expect(h.suggest('ycomb', 5, NOW).map((r) => r.url)).toEqual(['https://news.ycombinator.com/'])
    expect(h.suggest('york', 5, NOW).map((r) => r.url)).toEqual(['https://www.nytimes.com/'])
    expect(h.suggest('   ', 5, NOW)).toEqual([])
    expect(h.suggest('"; DROP TABLE urls; --', 5, NOW)).toEqual([])
  })

  it('ranks frequent, recent and host matches first', () => {
    const h = db()
    for (let i = 0; i < 5; i++) h.addVisit('https://mail.google.com/', 'Inbox', NOW - i * 5000)
    h.addVisit('https://example.com/about-mail', 'About mail', NOW - 60 * DAY)
    expect(h.suggest('mail', 5, NOW)[0].url).toBe('https://mail.google.com/')
  })

  it('updates titles and favicons and keeps search in sync', () => {
    const h = db()
    h.addVisit('https://x.com/', '', NOW)
    h.setTitle('https://x.com/', 'Renamed page')
    h.setFavicon('https://x.com/', 'https://x.com/fav.ico')
    const [r] = h.suggest('renamed', 5, NOW)
    expect(r).toMatchObject({ title: 'Renamed page', favicon: 'https://x.com/fav.ico' })
  })

  it('lists visits newest first, pages with `before`, filters by search', () => {
    const h = db()
    h.addVisit('https://a.com/', 'Alpha', NOW - 3000)
    h.addVisit('https://b.com/', 'Beta', NOW - 2000)
    h.addVisit('https://c.com/', 'Gamma', NOW - 1000)
    expect(h.listVisits().map((v) => v.title)).toEqual(['Gamma', 'Beta', 'Alpha'])
    expect(h.listVisits({ before: NOW - 1500 }).map((v) => v.title)).toEqual(['Beta', 'Alpha'])
    expect(h.listVisits({ query: 'bet' }).map((v) => v.title)).toEqual(['Beta'])
  })

  it('deletes a page, a time range, and prunes old visits', () => {
    const h = db()
    h.addVisit('https://old.com/', 'Old', NOW - 100 * DAY)
    h.addVisit('https://mid.com/', 'Mid', NOW - 2 * DAY)
    h.addVisit('https://new.com/', 'New', NOW - 1000)
    h.deleteUrl('https://mid.com/')
    expect(h.suggest('mid', 5, NOW)).toEqual([])
    h.deleteSince(NOW - 3600_000)
    expect(h.listVisits().map((v) => v.title)).toEqual(['Old'])
    h.prune(NOW - 90 * DAY)
    expect(h.historyCount()).toBe(0)
    expect(h.suggest('old', 5, NOW)).toEqual([]) // search index cleaned up too
  })

  it('pruning old visits leaves other pages and newer visits untouched', () => {
    const h = db()
    for (let i = 0; i < 3; i++) h.addVisit('https://keep.com/', 'Keep', NOW - i * 5000)
    h.addVisit('https://mixed.com/', 'Mixed', NOW - 100 * DAY)
    h.addVisit('https://mixed.com/', 'Mixed', NOW - 2000)
    h.addVisit('https://gone.com/', 'Gone', NOW - 100 * DAY)
    h.prune(NOW - 90 * DAY)
    expect(h.suggest('keep', 5, NOW)[0]).toMatchObject({ visitCount: 3, lastVisit: NOW })
    expect(h.suggest('mixed', 5, NOW)[0]).toMatchObject({ visitCount: 1, lastVisit: NOW - 2000 })
    expect(h.suggest('gone', 5, NOW)).toEqual([])
    expect(h.historyCount()).toBe(2)
  })

  it('imports pages without lowering existing counts', () => {
    const h = db()
    for (let i = 0; i < 3; i++) h.addVisit('https://a.com/', 'A', NOW - i * 5000)
    const added = h.importUrls([
      { url: 'https://a.com/', title: 'A', visitCount: 1, lastVisit: NOW - DAY },
      { url: 'https://b.com/', title: 'Imported B', visitCount: 9, lastVisit: NOW - DAY },
    ])
    expect(added).toBe(1)
    expect(h.suggest('a.com', 5, NOW)[0].visitCount).toBe(3)
    expect(h.suggest('imported', 5, NOW)[0]).toMatchObject({ url: 'https://b.com/', visitCount: 9 })
  })
})

describe('downloads and permissions', () => {
  it('saves and lists downloads newest first', () => {
    const d = db()
    const base = { url: 'https://a.com/f', path: '/tmp/f', state: 'completed' as const, paused: false, received: 1, total: 1 }
    d.saveDownload({ ...base, id: '1', filename: 'one.pdf', startedAt: 1 })
    d.saveDownload({ ...base, id: '2', filename: 'two.zip', startedAt: 2 })
    d.saveDownload({ ...base, id: '1', filename: 'one-renamed.pdf', startedAt: 1 })
    expect(d.listDownloads().map((x) => x.filename)).toEqual(['two.zip', 'one-renamed.pdf'])
    d.deleteDownload('2')
    expect(d.listDownloads()).toHaveLength(1)
  })

  it('remembers permission decisions per profile', () => {
    const d = db()
    d.setPermission({ partition: 'p1', origin: 'https://meet.com', permission: 'media', allowed: true, updated: 1 })
    d.setPermission({ partition: 'p2', origin: 'https://meet.com', permission: 'media', allowed: false, updated: 1 })
    d.setPermission({ partition: 'p1', origin: 'https://meet.com', permission: 'media', allowed: false, updated: 2 })
    expect(d.listPermissions().map((p) => [p.partition, p.allowed])).toEqual([
      ['p1', false],
      ['p2', false],
    ])
    d.deletePermission('p1', 'https://meet.com', 'media')
    expect(d.listPermissions()).toHaveLength(1)
  })
})
