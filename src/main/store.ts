import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { targetFromLocale } from '../shared/translate'
import type { PersistedState } from '../shared/types'
import { MAX_ARCHIVE, migrate, persistable, repair } from './model'


function filePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

function defaultState(): PersistedState {
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
      translateTo: targetFromLocale(app.getLocale() || 'en'),
      autoPip: true,
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
let writing: Promise<void> | null = null

function serialize(state: PersistedState): string {
  // Private browsing never touches the disk.
  const safe = persistable(state)
  return JSON.stringify({ ...safe, archive: safe.archive.slice(0, MAX_ARCHIVE) })
}

/** Debounced, atomic (write temp file then rename) save, off the main thread's critical path. */
export function saveState(state: PersistedState): void {
  pending = state
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void writeAsync()
  }, 1500)
}

async function writeAsync(): Promise<void> {
  if (writing) await writing
  if (!pending) return
  const data = serialize(pending)
  pending = null
  const path = filePath()
  writing = (async () => {
    try {
      await writeFile(`${path}.tmp`, data)
      await rename(`${path}.tmp`, path)
    } catch (err) {
      console.error('Could not save browser state:', err)
    }
  })()
  await writing
  writing = null
}

/** Write right now, synchronously. Used when the app is quitting. */
export function flushState(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!pending) return
  const data = serialize(pending)
  pending = null
  const path = filePath()
  writeFileSync(`${path}.tmp`, data)
  renameSync(`${path}.tmp`, path)
}
