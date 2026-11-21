import { BrowserWindow, dialog, type Session } from 'electron'
import type { SitePermission } from '../shared/types'
import type { BrowserDB } from './db'

// Electron grants every permission by default. Instead, allow a small set of
// harmless ones and ask about the rest. Allow/Block answers are remembered per
// profile and can be reset in Settings → Site Permissions.

const ALWAYS_ALLOW = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'speaker-selection',
  'window-management',
  // Embedded widgets (reCAPTCHA, sign-in buttons, video players) ask for their
  // own cookies. This browser doesn't block third-party cookies, so they
  // already have that access and a prompt would change nothing; Chrome doesn't
  // ask in that case either. Revisit if third-party cookie blocking is added.
  'storage-access',
  'top-level-storage-access',
])

const ASK: Record<string, string> = {
  media: 'use your camera and/or microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'read your clipboard',
  'display-capture': 'record your screen',
  midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices',
  'idle-detection': 'know when you are idle',
}

/** Remembered decisions: "partition|origin|permission" → allowed. */
const decisions = new Map<string, boolean>()
let store: BrowserDB | null = null

const keyOf = (partition: string, origin: string, permission: string) => `${partition}|${origin}|${permission}`

/** Load saved decisions. Call once at startup. */
export function loadPermissions(db: BrowserDB | null) {
  store = db
  try {
    for (const p of db?.listPermissions() ?? []) {
      // Answers saved for permissions that are no longer asked about are dropped.
      if (ALWAYS_ALLOW.has(p.permission)) db?.deletePermission(p.partition, p.origin, p.permission)
      else decisions.set(keyOf(p.partition, p.origin, p.permission), p.allowed)
    }
  } catch (err) {
    console.error('Could not load site permissions:', err)
  }
}

/** The remembered answer for a site, or undefined if it will be asked. */
export function getPermission(partition: string, origin: string, permission: string): boolean | undefined {
  return decisions.get(keyOf(partition, origin, permission))
}

/** Set a site's answer from the lock menu: Allow, Block, or null to ask next time. */
export function setPermission(partition: string, origin: string, permission: string, allowed: boolean | null) {
  if (allowed === null) forgetPermission({ partition, origin, permission })
  else remember(partition, origin, permission, allowed)
}

/** Forget a decision (Settings → Site Permissions → Reset); the site will ask again. */
export function forgetPermission(p: Pick<SitePermission, 'partition' | 'origin' | 'permission'>) {
  decisions.delete(keyOf(p.partition, p.origin, p.permission))
  try {
    store?.deletePermission(p.partition, p.origin, p.permission)
  } catch (err) {
    console.error('Could not delete site permission:', err)
  }
}

/** Profiles whose answers are kept only in memory (private browsing). */
const ephemeral = new Set<string>()

/** Forget every answer for a profile (a private space was closed). */
export function forgetPartitionPermissions(partition: string) {
  for (const key of [...decisions.keys()]) if (key.startsWith(`${partition}|`)) decisions.delete(key)
  ephemeral.delete(partition)
}

function remember(partition: string, origin: string, permission: string, allowed: boolean) {
  decisions.set(keyOf(partition, origin, permission), allowed)
  if (ephemeral.has(partition)) return
  try {
    store?.setPermission({ partition, origin, permission, allowed, updated: Date.now() })
  } catch (err) {
    console.error('Could not save site permission:', err)
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}

function isExtension(url: string): boolean {
  return url.startsWith('chrome-extension://')
}

export function installPermissionHandlers(ses: Session, partition: string, persist = true): void {
  if (!persist) ephemeral.add(partition)
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL()
    if (ALWAYS_ALLOW.has(permission) || isExtension(url)) return callback(true)
    const what = ASK[permission]
    if (!what) return callback(false)

    const origin = originOf(url)
    const remembered = decisions.get(keyOf(partition, origin, permission))
    if (remembered !== undefined) return callback(remembered)

    const win = BrowserWindow.fromWebContents(wc) ?? BrowserWindow.getFocusedWindow()
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Allow', 'Block', 'Not Now'],
      defaultId: 0,
      cancelId: 2,
      message: `${hostOf(origin)} wants to ${what}`,
      detail: 'You can change this later in Settings → Site Permissions.',
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 2) return callback(false) // "Not Now": ask again next time
    const allowed = response === 0
    remember(partition, origin, permission, allowed)
    callback(allowed)
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALWAYS_ALLOW.has(permission) || isExtension(requestingOrigin)) return true
    return decisions.get(keyOf(partition, originOf(requestingOrigin), permission)) === true
  })
}
