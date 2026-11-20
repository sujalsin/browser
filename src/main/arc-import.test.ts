import { describe, expect, it } from 'vitest'
import type { PersistedState } from '../shared/types'
import { applyArcPlan, chromeTimeToMs, countPlan, parseArcSidebar } from './arc-import'
import { favoritesOf, sidebarOrder, tabById } from './model'

const tab = (id: string, parentID: string, url: string, savedTitle = '', title: string | null = null) => [
  id,
  { id, parentID, title, data: { tab: { savedURL: url, savedTitle } } },
]

/** A StorableSidebar.json in Arc's shape: Swift dictionaries as [key, value, …] arrays. */
const ARC = {
  sidebar: {
    containers: [
      { global: {} },
      {
        topAppsContainerIDs: [{ default: {} }, 'FAV', { custom: { _0: { directoryBasename: 'Profile 1' } } }, 'FAV2'],
        spaces: [
          'S1',
          {
            id: 'S1',
            title: 'Personal',
            profile: { default: {} },
            containerIDs: ['pinned', 'P1', 'unpinned', 'U1'],
            customInfo: { windowTheme: { background: { single: { _0: { style: { color: { _0: { blendedSingleColor: { _0: { color: { red: 1, green: 0.5, blue: 0, alpha: 1 } } } } } } } } } } },
          },
          'S2',
          { id: 'S2', title: '  ', profile: { custom: { _0: { directoryBasename: 'Profile 1' } } }, containerIDs: ['unpinned', 'U2', 'pinned', 'P2'] },
        ],
        items: [
          'P1',
          { id: 'P1', childrenIds: ['t1', 'f1', 'sv'], data: { itemContainer: {} } },
          ...tab('t1', 'P1', 'https://mail.com/', 'Mail'),
          'f1',
          { id: 'f1', parentID: 'P1', title: 'Work', childrenIds: ['t2', 'f2'], data: { list: {} } },
          ...tab('t2', 'f1', 'https://docs.com/', 'Docs page', 'My Docs'),
          'f2',
          { id: 'f2', parentID: 'f1', title: 'Deep', childrenIds: ['t3'], data: { list: {} } },
          ...tab('t3', 'f2', 'https://deep.com/'),
          'sv',
          { id: 'sv', parentID: 'P1', childrenIds: ['t4', 't5'], data: { splitView: {} } },
          ...tab('t4', 'sv', 'https://left.com/'),
          ...tab('t5', 'sv', 'https://right.com/'),
          'U1',
          { id: 'U1', childrenIds: ['t6', 't7'] },
          ...tab('t6', 'U1', 'javascript:alert(1)'),
          ...tab('t7', 'U1', 'https://today.com/', 'Today'),
          // P2 has no childrenIds: children are found through parentID.
          'P2',
          { id: 'P2' },
          ...tab('t8', 'P2', 'https://work.com/', 'Work app'),
          'FAV',
          { id: 'FAV', childrenIds: ['t9'] },
          ...tab('t9', 'FAV', 'https://fav.com/', 'Fav'),
          'FAV2',
          { id: 'FAV2', childrenIds: ['t10'] },
          ...tab('t10', 'FAV2', 'https://work-fav.com/'),
        ],
      },
      // Little Arc windows are skipped.
      { littleBrowser: {} },
      { spaces: ['X', { id: 'X', title: 'Little' }], items: [] },
    ],
  },
}

function emptyState(): PersistedState {
  return {
    version: 2,
    spaces: [{ id: 'mine', name: 'Mine', color: '#000', partition: 'persist:main', pinned: [], today: [], lastTabId: null }],
    activeSpaceId: 'mine',
    tabs: [],
    folders: [],
    favorites: {},
    splits: [],
    boosts: [],
    activeTabId: null,
    archive: [],
    sidebarVisible: true,
    searchEngine: 'google',
    settings: { sleepAfterMinutes: 15, preferH264: false, archiveAfterHours: 12, appearance: 'system', peekFromPinned: true, littleArcForLinks: true },
    shields: { enabled: true, disabledSites: [], blockCookieBanners: true, upgradeHttps: true, stripTrackingParams: true },
  }
}

describe('parseArcSidebar', () => {
  const plan = parseArcSidebar(ARC)

  it('reads spaces with titles, profiles and colors', () => {
    expect(plan.spaces.map((s) => [s.title, s.profile, s.color])).toEqual([
      ['Personal', 'Default', '#ff8000'],
      ['Space 1', 'Profile 1', null],
    ])
  })

  it('reads pinned tabs, folders (nested) and flattens split views', () => {
    expect(plan.spaces[0].pinned).toEqual([
      { type: 'tab', url: 'https://mail.com/', title: 'Mail' },
      {
        type: 'folder',
        title: 'Work',
        items: [
          { type: 'tab', url: 'https://docs.com/', title: 'My Docs' },
          { type: 'folder', title: 'Deep', items: [{ type: 'tab', url: 'https://deep.com/', title: '' }] },
        ],
      },
      { type: 'tab', url: 'https://left.com/', title: '' },
      { type: 'tab', url: 'https://right.com/', title: '' },
    ])
  })

  it('finds children by parentID and skips unsafe URLs', () => {
    expect(plan.spaces[1].pinned).toEqual([{ type: 'tab', url: 'https://work.com/', title: 'Work app' }])
    expect(plan.spaces[0].today.map((t) => t.url)).toEqual(['https://today.com/'])
  })

  it('reads favorites per profile', () => {
    expect(plan.favorites.map((f) => [f.url, f.profile])).toEqual([
      ['https://fav.com/', 'Default'],
      ['https://work-fav.com/', 'Profile 1'],
    ])
  })

  it('counts what will be imported', () => {
    expect(countPlan(plan)).toEqual({ spaces: 2, pinned: 6, folders: 2, today: 1, favorites: 2, profiles: 2 })
  })

  it('survives garbage', () => {
    expect(parseArcSidebar(null)).toEqual({ spaces: [], favorites: [] })
    expect(parseArcSidebar({ sidebar: { containers: 'nope' } })).toEqual({ spaces: [], favorites: [] })
  })
})

describe('applyArcPlan', () => {
  it('adds spaces, pinned tabs, folders, Today and favorites without touching existing spaces', () => {
    const s = emptyState()
    let n = 0
    const created = applyArcPlan(s, parseArcSidebar(ARC), {
      partitionFor: (p) => (p === 'Default' ? 'persist:main' : `persist:arc-${p}`),
      newId: () => `id${++n}`,
      palette: ['#111111'],
      now: 5,
    })
    expect(created).toHaveLength(2)
    expect(s.spaces.map((sp) => [sp.name, sp.partition, sp.color])).toEqual([
      ['Mine', 'persist:main', '#000'],
      ['Personal', 'persist:main', '#ff8000'],
      ['Space 1', 'persist:arc-Profile 1', '#111111'],
    ])
    const personal = s.spaces[1]
    // Nested folder "Deep" becomes a sibling folder "Work / Deep".
    expect(s.folders.map((f) => f.name)).toEqual(['Work', 'Work / Deep'])
    const urls = (ids: string[]) => ids.map((id) => tabById(s, id)?.url)
    expect(urls(sidebarOrder(s, personal.id))).toEqual([
      'https://fav.com/', // favorite of the Default profile
      'https://mail.com/',
      'https://docs.com/',
      'https://deep.com/',
      'https://left.com/',
      'https://right.com/',
      'https://today.com/',
    ])
    expect(tabById(s, sidebarOrder(s, personal.id)[1])).toMatchObject({ kind: 'pinned', pinnedUrl: 'https://mail.com/' })
    expect(urls(favoritesOf(s, 'persist:arc-Profile 1'))).toEqual(['https://work-fav.com/'])
  })

  it('does not duplicate favorites on a second import', () => {
    const s = emptyState()
    let n = 0
    const opts = { partitionFor: () => 'persist:main', newId: () => `id${++n}`, palette: ['#111111'], now: 5 }
    applyArcPlan(s, parseArcSidebar(ARC), opts)
    applyArcPlan(s, parseArcSidebar(ARC), opts)
    expect(favoritesOf(s, 'persist:main').map((id) => tabById(s, id)?.url)).toEqual(['https://fav.com/', 'https://work-fav.com/'])
  })
})

describe('chromeTimeToMs', () => {
  it('converts Chromium timestamps', () => {
    // 2024-01-01T00:00:00Z
    expect(chromeTimeToMs(13348540800000000)).toBe(Date.UTC(2024, 0, 1))
  })
})

describe('readArcHistory', () => {
  it('reads web pages from a Chromium History file, newest first', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { DatabaseSync } = await import('node:sqlite')
    const { readArcHistory } = await import('./arc-import')
    const dir = mkdtempSync(join(tmpdir(), 'arc-test-'))
    try {
      const file = join(dir, 'History')
      const db = new DatabaseSync(file)
      db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
      const t = (ms: number) => (ms + 11_644_473_600_000) * 1000
      const ins = db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)')
      ins.run('https://new.com/', 'New', 3, t(2000), 0)
      ins.run('https://old.com/', 'Old', 1, t(1000), 0)
      ins.run('https://hidden.com/', 'Hidden', 1, t(1500), 1)
      ins.run('chrome://settings/', 'Settings', 1, t(1500), 0)
      ins.run('https://ancient.com/', 'Ancient', 1, t(10), 0)
      db.close()
      expect(readArcHistory(file, 500)).toEqual([
        { url: 'https://new.com/', title: 'New', visitCount: 3, lastVisit: 2000 },
        { url: 'https://old.com/', title: 'Old', visitCount: 1, lastVisit: 1000 },
      ])
      expect(readArcHistory(join(dir, 'missing'), 0)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
