// The sidebar's tree: spaces → (pinned | today) → folders → tabs, plus
// favorites per profile. Pure functions over PersistedState (no Electron), so
// they are unit-tested on their own. They mutate the state they are given.
import { getDomain } from 'tldts-experimental'
import type { ArchivedTab, Folder, ListRef, PersistedState, Space, Tab, TabKind } from '../shared/types'

export interface Location {
  spaceId: string
  ref: ListRef
  list: string[]
  index: number
}

// ───────────────────────────── lookups ─────────────────────────────

export function spaceById(s: PersistedState, id: string | null | undefined): Space | undefined {
  return id ? s.spaces.find((sp) => sp.id === id) : undefined
}

export function activeSpace(s: PersistedState): Space {
  return spaceById(s, s.activeSpaceId) ?? s.spaces[0]
}

export function tabById(s: PersistedState, id: string | null | undefined): Tab | undefined {
  return id ? s.tabs.find((t) => t.id === id) : undefined
}

export function folderById(s: PersistedState, id: string | null | undefined): Folder | undefined {
  return id ? s.folders.find((f) => f.id === id) : undefined
}

export function favoritesOf(s: PersistedState, partition: string): string[] {
  return (s.favorites[partition] ??= [])
}

/** The array behind a list in a space (mutable). */
export function listArray(s: PersistedState, spaceId: string, ref: ListRef): string[] | null {
  const space = spaceById(s, spaceId)
  if (ref.type === 'folder') return folderById(s, ref.id)?.children ?? null
  if (!space) return null
  if (ref.type === 'favorites') return favoritesOf(s, space.partition)
  return ref.type === 'pinned' ? space.pinned : space.today
}

/** Find which list an item (tab or folder id) is in. */
export function locate(s: PersistedState, id: string): Location | null {
  for (const space of s.spaces) {
    let i = space.pinned.indexOf(id)
    if (i >= 0) return { spaceId: space.id, ref: { type: 'pinned' }, list: space.pinned, index: i }
    i = space.today.indexOf(id)
    if (i >= 0) return { spaceId: space.id, ref: { type: 'today' }, list: space.today, index: i }
  }
  for (const folder of s.folders) {
    const i = folder.children.indexOf(id)
    if (i >= 0) return { spaceId: folder.spaceId, ref: { type: 'folder', id: folder.id }, list: folder.children, index: i }
  }
  for (const [partition, list] of Object.entries(s.favorites)) {
    const i = list.indexOf(id)
    if (i >= 0) {
      const spaceId = s.spaces.find((sp) => sp.partition === partition)?.id ?? ''
      return { spaceId, ref: { type: 'favorites' }, list, index: i }
    }
  }
  return null
}

/** Tab kind implied by living in a list. */
export function kindFor(s: PersistedState, ref: ListRef): TabKind {
  if (ref.type === 'favorites') return 'favorite'
  if (ref.type === 'pinned') return 'pinned'
  if (ref.type === 'today') return 'today'
  const where = locate(s, ref.id)
  return where?.ref.type === 'today' ? 'today' : 'pinned'
}

function setKind(tab: Tab, kind: TabKind) {
  tab.kind = kind
  // Pinned tabs and favorites remember where they "live"; Today tabs don't.
  if (kind === 'today') tab.pinnedUrl = undefined
  else tab.pinnedUrl ??= tab.url
}

// ───────────────────────────── structural edits ─────────────────────────────

/** Remove an item from whatever list holds it. */
export function detach(s: PersistedState, id: string): Location | null {
  const loc = locate(s, id)
  if (loc) loc.list.splice(loc.index, 1)
  return loc
}

/** Put an (unattached) item into a list and update the tab/folder to match. */
function insertAt(s: PersistedState, id: string, spaceId: string, ref: ListRef, index: number): boolean {
  const list = listArray(s, spaceId, ref)
  if (!list) return false
  list.splice(Math.max(0, Math.min(index, list.length)), 0, id)
  const tab = tabById(s, id)
  if (tab) {
    tab.spaceId = ref.type === 'folder' ? (folderById(s, ref.id)?.spaceId ?? spaceId) : spaceId
    tab.folderId = ref.type === 'folder' ? ref.id : undefined
    setKind(tab, kindFor(s, ref))
    return true
  }
  const folder = folderById(s, id)
  if (folder) {
    folder.spaceId = spaceId
    const kind = kindFor(s, ref)
    for (const childId of folder.children) {
      const child = tabById(s, childId)
      if (child) {
        child.spaceId = spaceId
        setKind(child, kind)
      }
    }
  }
  return true
}

/** Can `id` go into `ref`? Folders only live in pinned/today (no nesting, no favorites). */
export function canMove(s: PersistedState, id: string, ref: ListRef): boolean {
  if (folderById(s, id)) return ref.type === 'pinned' || ref.type === 'today'
  if (!tabById(s, id)) return false
  return ref.type !== 'folder' || !!folderById(s, ref.id)
}

/**
 * Move an item to `index` in a list. `index` is a position in the target list
 * as it looks *before* the move (what the UI sees while dragging).
 */
export function moveItem(s: PersistedState, id: string, spaceId: string, ref: ListRef, index: number): boolean {
  if (!canMove(s, id, ref)) return false
  const target = listArray(s, spaceId, ref)
  if (!target) return false
  const from = locate(s, id)
  if (from && from.list === target && from.index < index) index -= 1
  detach(s, id)
  insertAt(s, id, spaceId, ref, index)
  removeEmptyAutoFolders(s)
  return true
}

export function addTab(s: PersistedState, tab: Tab, spaceId: string, ref: ListRef, index: number) {
  s.tabs.push(tab)
  if (!insertAt(s, tab.id, spaceId, ref, index)) insertAt(s, tab.id, spaceId, { type: 'today' }, 0)
}

export function removeTab(s: PersistedState, id: string): Location | null {
  const loc = detach(s, id)
  s.tabs = s.tabs.filter((t) => t.id !== id)
  s.splits = (s.splits ?? []).filter((sp) => !sp.tabIds.includes(id))
  removeEmptyAutoFolders(s)
  return loc
}

/** Tidy's folders disappear when their last tab leaves; your own folders stay. */
export function removeEmptyAutoFolders(s: PersistedState) {
  for (const f of s.folders.filter((f) => f.auto && f.children.length === 0)) {
    detach(s, f.id)
    s.folders = s.folders.filter((x) => x !== f)
  }
}

export function createFolder(
  s: PersistedState,
  spaceId: string,
  ref: { type: 'pinned' } | { type: 'today' },
  index: number,
  name: string,
  id: string,
  children: string[] = [],
  auto = false,
): Folder {
  const folder: Folder = { id, spaceId, name, collapsed: false, children: [], auto: auto || undefined }
  s.folders.push(folder)
  insertAt(s, id, spaceId, ref, index)
  for (const child of children) {
    if (!tabById(s, child)) continue
    detach(s, child)
    insertAt(s, child, spaceId, { type: 'folder', id }, folder.children.length)
  }
  return folder
}

/**
 * Delete a folder. With `keepTabs`, its tabs take its place in the list
 * ("Ungroup"); otherwise they are removed and their ids returned.
 */
export function removeFolder(s: PersistedState, folderId: string, keepTabs: boolean): string[] {
  const folder = folderById(s, folderId)
  if (!folder) return []
  const loc = detach(s, folderId)
  s.folders = s.folders.filter((f) => f.id !== folderId)
  const children = [...folder.children]
  if (!keepTabs) {
    s.tabs = s.tabs.filter((t) => !children.includes(t.id))
    return children
  }
  const spaceId = loc?.spaceId ?? folder.spaceId
  const ref = loc?.ref ?? { type: 'today' as const }
  children.forEach((child, i) => insertAt(s, child, spaceId, ref, (loc?.index ?? 0) + i))
  return []
}

// ───────────────────────────── traversal ─────────────────────────────

function flatten(s: PersistedState, ids: string[], includeCollapsed: boolean): string[] {
  const out: string[] = []
  for (const id of ids) {
    const folder = folderById(s, id)
    if (folder) {
      if (includeCollapsed || !folder.collapsed) out.push(...folder.children)
    } else {
      out.push(id)
    }
  }
  return out
}

/** Tab ids in sidebar order for a space: favorites, pinned, Today (folders expanded). */
export function sidebarOrder(s: PersistedState, spaceId: string, includeCollapsed = true): string[] {
  const space = spaceById(s, spaceId)
  if (!space) return []
  return [
    ...favoritesOf(s, space.partition),
    ...flatten(s, space.pinned, includeCollapsed),
    ...flatten(s, space.today, includeCollapsed),
  ]
}

export function todayTabIds(s: PersistedState, spaceId: string): string[] {
  const space = spaceById(s, spaceId)
  return space ? flatten(s, space.today, true) : []
}

// ───────────────────────────── archive ─────────────────────────────

export function archiveTab(s: PersistedState, id: string, now: number) {
  const tab = tabById(s, id)
  if (!tab) return
  const entry: ArchivedTab = { url: tab.url, title: tab.title, favicon: tab.favicon, spaceId: tab.spaceId, archivedAt: now }
  s.archive.unshift(entry)
  removeTab(s, id)
}

/** Arc's "Clear": archive every Today tab in a space (and drop Today folders). Returns removed tab ids. */
export function clearToday(s: PersistedState, spaceId: string, now: number): string[] {
  const space = spaceById(s, spaceId)
  if (!space) return []
  const ids = todayTabIds(s, spaceId)
  for (const id of ids) archiveTab(s, id, now)
  for (const id of [...space.today]) if (folderById(s, id)) removeFolder(s, id, false)
  return ids
}

/** Today tabs (any space) not used since `cutoff`. */
export function staleTodayTabs(s: PersistedState, cutoff: number): string[] {
  return s.spaces.flatMap((sp) => todayTabIds(s, sp.id)).filter((id) => (tabById(s, id)?.lastActiveAt ?? Infinity) < cutoff)
}

// ───────────────────────────── Tidy (rule-based, no AI) ─────────────────────────────

function dupeKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

/** Group label for a URL: its site, e.g. "github.com" for docs.github.com. */
export function siteLabel(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return getDomain(u.hostname) ?? u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export interface TidyResult {
  /** Duplicate tabs that were closed, with where they were (for reopening). */
  closed: { tab: Tab; loc: Location }[]
  foldersCreated: number
}

/**
 * Arc's Tidy without AI, for one space's Today section:
 * 1. close duplicate tabs (keeps pinned/favorites and the most recently used copy),
 * 2. group tabs from the same site into folders,
 * 3. order everything by most recent use.
 * Your own folders are left alone; Tidy's earlier folders are regrouped.
 */
export function tidy(s: PersistedState, spaceId: string, keepId: string | null, newId: () => string): TidyResult {
  const space = spaceById(s, spaceId)
  const result: TidyResult = { closed: [], foldersCreated: 0 }
  if (!space) return result

  // 1. Duplicates.
  const seen = new Set<string>()
  for (const id of [...favoritesOf(s, space.partition), ...flatten(s, space.pinned, true)]) {
    const tab = tabById(s, id)
    if (tab) seen.add(dupeKey(tab.url))
  }
  const today = todayTabIds(s, spaceId)
    .map((id) => tabById(s, id)!)
    .filter(Boolean)
    .sort((a, b) => (a.id === keepId ? -1 : b.id === keepId ? 1 : b.lastActiveAt - a.lastActiveAt))
  for (const tab of today) {
    const key = dupeKey(tab.url)
    if (seen.has(key) && tab.id !== keepId) {
      const loc = locate(s, tab.id)
      if (loc) result.closed.push({ tab: { ...tab }, loc: { ...loc, list: [] } })
      removeTab(s, tab.id)
    } else {
      seen.add(key)
    }
  }

  // 2. Undo Tidy's previous grouping so it can regroup from scratch.
  for (const id of [...space.today]) {
    if (folderById(s, id)?.auto) removeFolder(s, id, true)
  }

  // 3. Group loose tabs by site; build units ordered by recency.
  type Unit = { ids: string[]; folder?: string; site?: string; recent: number }
  const recentOf = (ids: string[]) => Math.max(0, ...ids.map((id) => tabById(s, id)?.lastActiveAt ?? 0))
  const units: Unit[] = []
  const bySite = new Map<string, string[]>()
  for (const id of space.today) {
    if (folderById(s, id)) {
      units.push({ ids: [id], folder: id, recent: recentOf(folderById(s, id)!.children) })
      continue
    }
    const site = siteLabel(tabById(s, id)?.url ?? '')
    if (!site) {
      units.push({ ids: [id], recent: recentOf([id]) })
      continue
    }
    if (!bySite.has(site)) bySite.set(site, [])
    bySite.get(site)!.push(id)
  }
  for (const [site, ids] of bySite) {
    units.push(ids.length > 1 ? { ids, site, recent: recentOf(ids) } : { ids, recent: recentOf(ids) })
  }
  units.sort((a, b) => b.recent - a.recent)

  space.today.length = 0
  for (const unit of units) {
    if (unit.site) {
      // Most recently used first inside the group.
      const ids = [...unit.ids].sort((a, b) => (tabById(s, b)?.lastActiveAt ?? 0) - (tabById(s, a)?.lastActiveAt ?? 0))
      const folder = createFolder(s, spaceId, { type: 'today' }, space.today.length, unit.site, newId(), [], true)
      for (const id of ids) insertAt(s, id, spaceId, { type: 'folder', id: folder.id }, folder.children.length)
      result.foldersCreated++
    } else {
      space.today.push(...unit.ids)
    }
  }
  return result
}

// ───────────────────────────── loading old / damaged state ─────────────────────────────

interface V1Tab extends Omit<Tab, 'kind'> {
  pinned?: boolean
  kind?: TabKind
}

/** Upgrade a version-1 state (flat tab list with `pinned` flags) to the tree model. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.version !== 1) return raw
  const tabs = (raw.tabs as V1Tab[]) ?? []
  const spaces = ((raw.spaces as Space[]) ?? []).map((sp) => ({
    ...sp,
    pinned: tabs.filter((t) => t.spaceId === sp.id && t.pinned).map((t) => t.id),
    today: tabs.filter((t) => t.spaceId === sp.id && !t.pinned).map((t) => t.id),
    lastTabId: tabs.some((t) => t.id === raw.activeTabId && t.spaceId === sp.id) ? (raw.activeTabId as string) : null,
  }))
  const newTabs = tabs.map(({ pinned, ...t }) => ({ ...t, kind: (pinned ? 'pinned' : 'today') as TabKind }))
  return { ...raw, version: 2, spaces, tabs: newTabs, folders: [], favorites: {} }
}

/**
 * Make the state self-consistent: every tab and folder in exactly one list,
 * no references to missing items. Protects against bugs and hand-edited files.
 */
export function repair(s: PersistedState) {
  s.folders ??= []
  s.favorites ??= {}
  for (const sp of s.spaces) {
    sp.pinned ??= []
    sp.today ??= []
    sp.lastTabId ??= null
  }
  const tabIds = new Set(s.tabs.map((t) => t.id))
  const folderIds = new Set(s.folders.map((f) => f.id))
  const placed = new Set<string>()
  const keep = (id: string, allowFolders: boolean) => {
    if (placed.has(id)) return false
    if (!(tabIds.has(id) || (allowFolders && folderIds.has(id)))) return false
    placed.add(id)
    return true
  }
  for (const sp of s.spaces) {
    sp.pinned = sp.pinned.filter((id) => keep(id, true))
    sp.today = sp.today.filter((id) => keep(id, true))
  }
  for (const f of s.folders) f.children = f.children.filter((id) => keep(id, false))
  for (const key of Object.keys(s.favorites)) s.favorites[key] = s.favorites[key].filter((id) => keep(id, false))
  // Folders that aren't in any list are dropped (their tabs fall through below).
  s.folders = s.folders.filter((f) => placed.has(f.id))
  // Tabs not in any list: put them at the end of their space's Today.
  for (const tab of s.tabs) {
    if (placed.has(tab.id)) continue
    const space = spaceById(s, tab.spaceId) ?? s.spaces[0]
    tab.spaceId = space.id
    tab.folderId = undefined
    setKind(tab, 'today')
    space.today.push(tab.id)
  }
  for (const sp of s.spaces) if (sp.lastTabId && !tabIds.has(sp.lastTabId)) sp.lastTabId = null
  // Splits need both tabs, and a tab can be in only one split.
  s.splits ??= []
  s.boosts ??= []
  const inSplit = new Set<string>()
  s.splits = s.splits.filter((sp) => {
    const ok = sp.tabIds.length === 2 && sp.tabIds[0] !== sp.tabIds[1] && sp.tabIds.every((id) => tabIds.has(id) && !inSplit.has(id))
    if (ok) sp.tabIds.forEach((id) => inSplit.add(id))
    return ok
  })
  if (!spaceById(s, s.activeSpaceId)) s.activeSpaceId = s.spaces[0].id
  if (s.activeTabId && !tabIds.has(s.activeTabId)) s.activeTabId = null
}
