// Import from Arc: spaces, pinned tabs, folders, Today tabs and Favorites from
// ~/Library/Application Support/Arc/StorableSidebar.json, plus browsing history
// from Arc's Chromium profiles. The file format follows what Firefox's and
// Zen's Arc migrators document. No Electron imports, so it is unit-tested.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PersistedState, Space } from '../shared/types'
import { addTab, createFolder, favoritesOf, tabById } from './model'

export const ARC_DEFAULT_PROFILE = 'Default'
const MAX_DEPTH = 32
const IMPORTABLE = new Set(['http:', 'https:', 'file:'])

export interface ArcTab {
  type: 'tab'
  url: string
  title: string
}
export interface ArcFolder {
  type: 'folder'
  title: string
  items: ArcItem[]
}
export type ArcItem = ArcTab | ArcFolder

export interface ArcSpacePlan {
  title: string
  /** Arc (Chromium) profile directory, e.g. "Default" or "Profile 1". */
  profile: string
  color: string | null
  pinned: ArcItem[]
  today: ArcTab[]
}

export interface ArcPlan {
  spaces: ArcSpacePlan[]
  favorites: (ArcTab & { profile: string })[]
}

/** Arc stores Swift dictionaries as flat arrays: [key, value, key, value, …]. */
function pairs(list: unknown): [unknown, unknown][] {
  const out: [unknown, unknown][] = []
  if (!Array.isArray(list)) return out
  for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i], list[i + 1]])
  return out
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

interface ArcRawItem {
  id: string
  parentID?: string
  childrenIds?: string[]
  title?: string | null
  data?: { tab?: { savedURL?: string; savedTitle?: string }; list?: unknown; splitView?: unknown }
}

function profileOf(marker: unknown): string {
  const dir = (marker as { custom?: { _0?: { directoryBasename?: unknown } } })?.custom?._0?.directoryBasename
  return typeof dir === 'string' && dir ? dir : ARC_DEFAULT_PROFILE
}

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url.trim())
    return IMPORTABLE.has(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

/** First RGB color in a space's theme, as #rrggbb. */
function spaceColor(space: Record<string, unknown>): string | null {
  const theme = (space.customInfo as { windowTheme?: unknown } | undefined)?.windowTheme
  let found: string | null = null
  const visit = (node: unknown, depth: number) => {
    if (found || !node || typeof node !== 'object' || depth > MAX_DEPTH) return
    const c = node as { red?: unknown; green?: unknown; blue?: unknown; alpha?: unknown }
    if (typeof c.red === 'number' && typeof c.green === 'number' && typeof c.blue === 'number') {
      if (typeof c.alpha === 'number' && c.alpha <= 0) return
      const hex = (v: number) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, '0')
      found = `#${hex(c.red)}${hex(c.green)}${hex(c.blue)}`
      return
    }
    for (const v of Array.isArray(node) ? node : Object.values(node)) visit(v, depth + 1)
  }
  visit(theme, 0)
  return found
}

function flattenTabs(items: ArcItem[]): ArcTab[] {
  return items.flatMap((i) => (i.type === 'tab' ? [i] : flattenTabs(i.items)))
}

/** Read Arc's sidebar file into an import plan. Unknown shapes are skipped, never thrown on. */
export function parseArcSidebar(json: unknown): ArcPlan {
  const plan: ArcPlan = { spaces: [], favorites: [] }
  const containers = (json as { sidebar?: { containers?: unknown } })?.sidebar?.containers
  for (const [kind, container] of pairs(containers)) {
    // "global" is the main window; "littleBrowser" entries are Little Arc windows.
    if (!(kind as { global?: unknown })?.global || !container || typeof container !== 'object') continue
    const c = container as { items?: unknown; spaces?: unknown; topAppsContainerIDs?: unknown }
    const items = new Map<string, ArcRawItem>()
    for (const [, item] of pairs(c.items)) {
      if (item && typeof item === 'object' && typeof (item as ArcRawItem).id === 'string') items.set((item as ArcRawItem).id, item as ArcRawItem)
    }
    const childrenOf = (parentId: string): ArcRawItem[] => {
      const parent = items.get(parentId)
      const byIds = Array.isArray(parent?.childrenIds) ? parent!.childrenIds.map((id) => items.get(id)).filter((x): x is ArcRawItem => !!x) : []
      return byIds.length ? byIds : [...items.values()].filter((i) => i.parentID === parentId)
    }
    const convert = (parentId: string, depth: number, seen = new Set([parentId])): ArcItem[] => {
      const out: ArcItem[] = []
      if (depth > MAX_DEPTH) return out
      for (const item of childrenOf(parentId)) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const data = item.data ?? {}
        if (data.tab) {
          const url = normalizeUrl(data.tab.savedURL)
          if (url) out.push({ type: 'tab', url, title: str(item.title) || str(data.tab.savedTitle) })
        } else if (data.list) {
          const inner = convert(item.id, depth + 1, seen)
          if (inner.length) out.push({ type: 'folder', title: str(item.title) || 'Folder', items: inner })
        } else if (data.splitView) {
          out.push(...convert(item.id, depth + 1, seen)) // split views become their tabs
        }
      }
      return out
    }

    for (const [marker, containerId] of pairs(c.topAppsContainerIDs)) {
      if (typeof containerId !== 'string') continue
      const profile = profileOf(marker)
      for (const tab of flattenTabs(convert(containerId, 0))) plan.favorites.push({ ...tab, profile })
    }

    for (const [, raw] of pairs(c.spaces)) {
      if (!raw || typeof raw !== 'object') continue
      const space = raw as Record<string, unknown>
      const ids = pairs(space.containerIDs)
      const pinnedId = ids.find(([k]) => k === 'pinned')?.[1]
      const todayId = ids.find(([k]) => k === 'unpinned')?.[1]
      const profile = profileOf(space.profile)
      const n = plan.spaces.filter((s) => s.profile === profile).length + 1
      plan.spaces.push({
        title: str(space.title).trim() || `Space ${n}`,
        profile,
        color: spaceColor(space),
        pinned: typeof pinnedId === 'string' ? convert(pinnedId, 0) : [],
        today: typeof todayId === 'string' ? flattenTabs(convert(todayId, 0)) : [],
      })
    }
  }
  return plan
}

export function countPlan(plan: ArcPlan) {
  const all = plan.spaces.flatMap((s) => s.pinned)
  const folders = (items: ArcItem[]): number => items.reduce((n, i) => n + (i.type === 'folder' ? 1 + folders(i.items) : 0), 0)
  return {
    spaces: plan.spaces.length,
    pinned: flattenTabs(all).length,
    folders: folders(all),
    today: plan.spaces.reduce((n, s) => n + s.today.length, 0),
    favorites: plan.favorites.length,
    profiles: new Set([...plan.spaces.map((s) => s.profile), ...plan.favorites.map((f) => f.profile)]).size,
  }
}

/**
 * Add an Arc plan to the browser state as new spaces (existing spaces are not
 * touched). `partitionFor` maps an Arc profile to a session partition.
 * Returns the ids of the created spaces.
 */
export function applyArcPlan(
  s: PersistedState,
  plan: ArcPlan,
  opts: { partitionFor(profile: string): string; newId(): string; palette: string[]; now: number },
): string[] {
  const created: string[] = []
  const newTab = (t: ArcTab, spaceId: string) => ({
    id: opts.newId(),
    spaceId,
    url: t.url,
    title: t.title || t.url,
    kind: 'today' as const,
    createdAt: opts.now,
    lastActiveAt: opts.now,
  })

  plan.spaces.forEach((sp, i) => {
    const space: Space = {
      id: opts.newId(),
      name: sp.title.slice(0, 40),
      color: sp.color ?? opts.palette[(s.spaces.length + i) % opts.palette.length],
      partition: opts.partitionFor(sp.profile),
      pinned: [],
      today: [],
      lastTabId: null,
    }
    s.spaces.push(space)
    created.push(space.id)

    // Our folders don't nest: a nested Arc folder becomes its own folder named "Parent / Child".
    const addFolder = (folder: ArcFolder, prefix: string) => {
      const name = (prefix ? `${prefix} / ${folder.title}` : folder.title).slice(0, 60)
      const f = createFolder(s, space.id, { type: 'pinned' }, space.pinned.length, name, opts.newId())
      f.collapsed = true
      const nested: ArcFolder[] = []
      for (const item of folder.items) {
        if (item.type === 'tab') addTab(s, newTab(item, space.id), space.id, { type: 'folder', id: f.id }, f.children.length)
        else nested.push(item)
      }
      for (const n of nested) addFolder(n, name)
    }
    for (const item of sp.pinned) {
      if (item.type === 'tab') addTab(s, newTab(item, space.id), space.id, { type: 'pinned' }, space.pinned.length)
      else addFolder(item, '')
    }
    for (const t of sp.today) addTab(s, newTab(t, space.id), space.id, { type: 'today' }, space.today.length)
  })

  // Favorites belong to a profile; add them for every profile that has a space here.
  for (const fav of plan.favorites) {
    const partition = opts.partitionFor(fav.profile)
    const owner = s.spaces.find((sp) => sp.partition === partition)
    if (!owner) continue
    const existing = favoritesOf(s, partition).map((id) => tabById(s, id)?.url)
    if (existing.includes(fav.url)) continue
    addTab(s, newTab(fav, owner.id), owner.id, { type: 'favorites' }, favoritesOf(s, partition).length)
  }
  return created
}

/** Milliseconds between 1601-01-01 (Chromium's epoch) and 1970-01-01. */
const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000

/** Chromium stores times as microseconds since 1601-01-01. */
export function chromeTimeToMs(t: number): number {
  return Math.round(t / 1000 - CHROME_EPOCH_OFFSET_MS)
}

export function arcHistoryPath(arcDir: string, profile: string): string {
  return join(arcDir, 'User Data', profile, 'History')
}

/**
 * Read pages from an Arc (Chromium) History database. The file is copied first:
 * Arc may still have it open, and we never write to Arc's data.
 */
export function readArcHistory(historyFile: string, sinceMs: number, limit = 50_000) {
  if (!existsSync(historyFile)) return []
  const dir = mkdtempSync(join(tmpdir(), 'arc-history-'))
  try {
    const copy = join(dir, 'History')
    copyFileSync(historyFile, copy)
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      // Chromium times (µs since 1601, ~1.3e16) are too big for a JS number:
      // let SQLite turn them into ms since 1601 (~1.3e13) first.
      const rows = db
        .prepare(
          `SELECT url, title, visit_count AS visitCount, last_visit_time / 1000 AS ms1601 FROM urls
           WHERE hidden = 0 AND last_visit_time / 1000 > ? AND (url LIKE 'http://%' OR url LIKE 'https://%')
           ORDER BY last_visit_time DESC LIMIT ?`,
        )
        .all(sinceMs + CHROME_EPOCH_OFFSET_MS, limit) as { url: string; title: string; visitCount: number; ms1601: number }[]
      return rows.map((r) => ({ url: r.url, title: r.title ?? '', visitCount: r.visitCount ?? 1, lastVisit: r.ms1601 - CHROME_EPOCH_OFFSET_MS }))
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
