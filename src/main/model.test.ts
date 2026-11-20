import { describe, expect, it } from 'vitest'
import type { PersistedState, Tab, TabKind } from '../shared/types'
import {
  addTab,
  clearToday,
  createFolder,
  locate,
  migrate,
  moveItem,
  removeFolder,
  removeTab,
  repair,
  sidebarOrder,
  staleTodayTabs,
  tabById,
  tidy,
} from './model'

function state(): PersistedState {
  return {
    version: 2,
    spaces: [
      { id: 'A', name: 'Personal', color: '#000', partition: 'p1', pinned: [], today: [], lastTabId: null },
      { id: 'B', name: 'Work', color: '#111', partition: 'p1', pinned: [], today: [], lastTabId: null },
      { id: 'C', name: 'Private', color: '#222', partition: 'p2', pinned: [], today: [], lastTabId: null },
    ],
    activeSpaceId: 'A',
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

let n = 0
function tab(id: string, url = `https://site${id}.com/`, lastActiveAt = 0): Tab {
  return { id, spaceId: 'A', url, title: id, kind: 'today' as TabKind, createdAt: 0, lastActiveAt }
}
const newId = () => `f${++n}`

describe('moving items', () => {
  it('moves a Today tab to pinned and gives it a pinned URL', () => {
    const s = state()
    addTab(s, tab('t1'), 'A', { type: 'today' }, 0)
    moveItem(s, 't1', 'A', { type: 'pinned' }, 0)
    expect(s.spaces[0].pinned).toEqual(['t1'])
    expect(s.spaces[0].today).toEqual([])
    expect(tabById(s, 't1')).toMatchObject({ kind: 'pinned', pinnedUrl: 'https://sitet1.com/' })
  })

  it('reorders within a list using pre-move indexes', () => {
    const s = state()
    for (const id of ['a', 'b', 'c']) addTab(s, tab(id), 'A', { type: 'today' }, s.spaces[0].today.length)
    moveItem(s, 'a', 'A', { type: 'today' }, 3) // drop after "c"
    expect(s.spaces[0].today).toEqual(['b', 'c', 'a'])
    moveItem(s, 'a', 'A', { type: 'today' }, 0)
    expect(s.spaces[0].today).toEqual(['a', 'b', 'c'])
  })

  it('favorites are shared by spaces with the same profile, not others', () => {
    const s = state()
    addTab(s, tab('f'), 'A', { type: 'today' }, 0)
    moveItem(s, 'f', 'A', { type: 'favorites' }, 0)
    expect(tabById(s, 'f')!.kind).toBe('favorite')
    expect(sidebarOrder(s, 'B')).toContain('f') // same profile p1
    expect(sidebarOrder(s, 'C')).not.toContain('f') // profile p2
  })

  it('moves a tab into a folder and to another space', () => {
    const s = state()
    addTab(s, tab('t'), 'A', { type: 'today' }, 0)
    const f = createFolder(s, 'A', { type: 'pinned' }, 0, 'Reading', 'F')
    moveItem(s, 't', 'A', { type: 'folder', id: f.id }, 0)
    expect(tabById(s, 't')).toMatchObject({ folderId: 'F', kind: 'pinned' })
    moveItem(s, 't', 'B', { type: 'today' }, 0)
    expect(tabById(s, 't')).toMatchObject({ spaceId: 'B', kind: 'today', folderId: undefined })
    expect(s.spaces[1].today).toEqual(['t'])
  })

  it('refuses to nest folders or favorite a folder', () => {
    const s = state()
    createFolder(s, 'A', { type: 'pinned' }, 0, 'One', 'F1')
    createFolder(s, 'A', { type: 'pinned' }, 1, 'Two', 'F2')
    expect(moveItem(s, 'F1', 'A', { type: 'folder', id: 'F2' }, 0)).toBe(false)
    expect(moveItem(s, 'F1', 'A', { type: 'favorites' }, 0)).toBe(false)
  })

  it('moving a folder from pinned to Today updates its tabs', () => {
    const s = state()
    addTab(s, tab('t'), 'A', { type: 'pinned' }, 0)
    createFolder(s, 'A', { type: 'pinned' }, 0, 'Docs', 'F', ['t'])
    moveItem(s, 'F', 'A', { type: 'today' }, 0)
    expect(tabById(s, 't')!.kind).toBe('today')
    expect(tabById(s, 't')!.pinnedUrl).toBeUndefined()
  })
})

describe('folders', () => {
  it('ungroup puts tabs where the folder was', () => {
    const s = state()
    for (const id of ['a', 'b', 'c']) addTab(s, tab(id), 'A', { type: 'today' }, s.spaces[0].today.length)
    createFolder(s, 'A', { type: 'today' }, 1, 'G', 'F', ['a', 'b'])
    expect(s.spaces[0].today).toEqual(['F', 'c'])
    removeFolder(s, 'F', true)
    expect(s.spaces[0].today).toEqual(['a', 'b', 'c'])
    expect(tabById(s, 'a')!.folderId).toBeUndefined()
  })

  it('Tidy folders vanish when emptied; user folders stay', () => {
    const s = state()
    addTab(s, tab('a'), 'A', { type: 'today' }, 0)
    addTab(s, tab('b'), 'A', { type: 'today' }, 0)
    createFolder(s, 'A', { type: 'today' }, 0, 'auto', 'AUTO', ['a'], true)
    createFolder(s, 'A', { type: 'today' }, 0, 'mine', 'MINE', ['b'])
    removeTab(s, 'a')
    removeTab(s, 'b')
    expect(s.folders.map((f) => f.id)).toEqual(['MINE'])
  })
})

describe('Clear and auto-archive', () => {
  it('Clear archives Today tabs (inside folders too) and keeps pinned', () => {
    const s = state()
    addTab(s, tab('p'), 'A', { type: 'pinned' }, 0)
    addTab(s, tab('a'), 'A', { type: 'today' }, 0)
    addTab(s, tab('b'), 'A', { type: 'today' }, 0)
    createFolder(s, 'A', { type: 'today' }, 0, 'G', 'F', ['b'])
    const removed = clearToday(s, 'A', 1000)
    expect(removed.sort()).toEqual(['a', 'b'])
    expect(s.archive.map((a) => a.url).sort()).toEqual(['https://sitea.com/', 'https://siteb.com/'])
    expect(s.spaces[0].today).toEqual([])
    expect(s.spaces[0].pinned).toEqual(['p'])
    expect(s.folders).toEqual([])
  })

  it('finds stale Today tabs only', () => {
    const s = state()
    addTab(s, tab('old', undefined, 100), 'A', { type: 'today' }, 0)
    addTab(s, tab('new', undefined, 900), 'A', { type: 'today' }, 0)
    addTab(s, tab('pinnedOld', undefined, 100), 'A', { type: 'pinned' }, 0)
    expect(staleTodayTabs(s, 500)).toEqual(['old'])
  })
})

describe('Tidy', () => {
  it('closes duplicates, keeping pinned copies and the most recent one', () => {
    const s = state()
    addTab(s, tab('pin', 'https://mail.com/inbox', 1), 'A', { type: 'pinned' }, 0)
    addTab(s, tab('dupOfPin', 'https://mail.com/inbox#x', 5), 'A', { type: 'today' }, 0)
    addTab(s, tab('older', 'https://news.com/a', 2), 'A', { type: 'today' }, 0)
    addTab(s, tab('newer', 'https://news.com/a/', 9), 'A', { type: 'today' }, 0)
    const r = tidy(s, 'A', null, newId)
    expect(r.closed.map((c) => c.tab.id).sort()).toEqual(['dupOfPin', 'older'])
    expect(tabById(s, 'newer')).toBeDefined()
    expect(tabById(s, 'pin')).toBeDefined()
  })

  it('never closes the tab you are looking at', () => {
    const s = state()
    addTab(s, tab('a', 'https://x.com/', 9), 'A', { type: 'today' }, 0)
    addTab(s, tab('b', 'https://x.com/', 1), 'A', { type: 'today' }, 0)
    const r = tidy(s, 'A', 'b', newId)
    expect(r.closed.map((c) => c.tab.id)).toEqual(['a'])
  })

  it('groups same-site tabs into folders ordered by recent use', () => {
    const s = state()
    addTab(s, tab('g1', 'https://github.com/a', 5), 'A', { type: 'today' }, 0)
    addTab(s, tab('solo', 'https://solo.org/', 8), 'A', { type: 'today' }, 0)
    addTab(s, tab('g2', 'https://docs.github.com/b', 7), 'A', { type: 'today' }, 0)
    const r = tidy(s, 'A', null, newId)
    expect(r.foldersCreated).toBe(1)
    const today = s.spaces[0].today
    expect(today[0]).toBe('solo') // most recent unit first
    const folder = s.folders.find((f) => f.id === today[1])!
    expect(folder).toMatchObject({ name: 'github.com', auto: true })
    expect(folder.children).toEqual(['g2', 'g1'])
  })

  it('is repeatable and leaves your own folders alone', () => {
    const s = state()
    addTab(s, tab('m1', 'https://a.com/1', 1), 'A', { type: 'today' }, 0)
    addTab(s, tab('m2', 'https://b.com/2', 2), 'A', { type: 'today' }, 0)
    createFolder(s, 'A', { type: 'today' }, 0, 'Mine', 'MINE', ['m1', 'm2'])
    addTab(s, tab('x1', 'https://x.com/1', 3), 'A', { type: 'today' }, 0)
    addTab(s, tab('x2', 'https://x.com/2', 4), 'A', { type: 'today' }, 0)
    tidy(s, 'A', null, newId)
    const first = JSON.stringify(s.spaces[0].today.map((id) => s.folders.find((f) => f.id === id)?.name ?? id))
    tidy(s, 'A', null, newId)
    const second = JSON.stringify(s.spaces[0].today.map((id) => s.folders.find((f) => f.id === id)?.name ?? id))
    expect(second).toBe(first)
    expect(s.folders.find((f) => f.id === 'MINE')!.children).toEqual(['m1', 'm2'])
  })
})

describe('loading saved state', () => {
  it('migrates version 1 files', () => {
    const v1 = {
      version: 1,
      spaces: [{ id: 'personal', name: 'Personal', color: '#000', partition: 'p' }],
      activeSpaceId: 'personal',
      tabs: [
        { id: 'x', spaceId: 'personal', url: 'https://x.com', title: 'x', pinned: true, pinnedUrl: 'https://x.com', createdAt: 0, lastActiveAt: 0 },
        { id: 'y', spaceId: 'personal', url: 'https://y.com', title: 'y', pinned: false, createdAt: 0, lastActiveAt: 0 },
      ],
      activeTabId: 'y',
    }
    const s = migrate(v1) as unknown as PersistedState
    expect(s.version).toBe(2)
    expect(s.spaces[0]).toMatchObject({ pinned: ['x'], today: ['y'], lastTabId: 'y' })
    expect(s.tabs.map((t) => t.kind)).toEqual(['pinned', 'today'])
    expect('pinned' in s.tabs[0]).toBe(false)
  })

  it('repairs orphaned and duplicated references', () => {
    const s = state()
    s.tabs.push(tab('orphan'), tab('twice'))
    s.spaces[0].pinned.push('twice', 'ghost')
    s.spaces[1].today.push('twice')
    repair(s)
    expect(s.spaces[0].pinned).toEqual(['twice'])
    expect(s.spaces[1].today).toEqual([])
    expect(locate(s, 'orphan')!.ref).toEqual({ type: 'today' })
  })
})
