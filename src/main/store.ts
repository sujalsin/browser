import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PersistedState } from '../shared/types'
import { migrate, repair } from './model'

const MAX_ARCHIVE = 500

function filePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

export function defaultState(): PersistedState {
  return {
    version: 2,
    spaces: [
      { id: 'personal', name: 'Personal', color: '#7c6cf2', partition: 'persist:space-personal', pinned: [], today: [], lastTabId: null },
    ],
    activeSpaceId: 'personal',
    tabs: [],
    folders: [],
    favorites: {},
    splits: [],
    boosts: [],
    activeTabId: null,
    archive: [],
    sidebarVisible: true,
    searchEngine: 'google',
    settings: {
      sleepAfterMinutes: 15,
      // Intel Macs can't hardware-decode VP9/AV1, which YouTube prefers.
      preferH264: process.platform === 'darwin' && process.arch === 'x64',
      archiveAfterHours: 12,
      appearance: 'system',
      peekFromPinned: true,
      littleArcForLinks: true,
    },
    shields: {
      enabled: true,
      disabledSites: [],
      blockCookieBanners: true,
      upgradeHttps: true,
      stripTrackingParams: true,
    },
  }
}

export function loadState(): PersistedState {
  const path = filePath()
  if (!existsSync(path)) return defaultState()
  try {
    const parsed = migrate(JSON.parse(readFileSync(path, 'utf8'))) as Partial<PersistedState>
    if (parsed.version !== 2 || !Array.isArray(parsed.spaces) || !parsed.spaces.length || !Array.isArray(parsed.tabs)) {
      throw new Error('unrecognized state file')
    }
    const defaults = defaultState()
    const state = {
      ...defaults,
      ...parsed,
      settings: { ...defaults.settings, ...parsed.settings },
      shields: { ...defaults.shields, ...parsed.shields },
    } as PersistedState
    repair(state)
    return state
  } catch (err) {
    // Keep the broken file for inspection instead of silently losing tabs.
    const backup = `${path}.broken-${Date.now()}`
    try {
      renameSync(path, backup)
    } catch {
      /* ignore */
    }
    console.error(`Could not read ${path} (${String(err)}); moved it to ${backup}`)
    return defaultState()
  }
}

let timer: NodeJS.Timeout | null = null
let pending: PersistedState | null = null

/** Debounced, atomic (write temp file then rename) save. */
export function saveState(state: PersistedState): void {
  pending = state
  if (timer) return
  timer = setTimeout(flushState, 1500)
}

export function flushState(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!pending) return
  const state = { ...pending, archive: pending.archive.slice(0, MAX_ARCHIVE) }
  pending = null
  const path = filePath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, path)
}
