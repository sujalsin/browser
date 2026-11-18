import { BrowserWindow, dialog, type Session } from 'electron'

// Electron grants every permission by default. Instead, allow a small set of
// harmless ones and ask about the rest, remembering answers until quit.
// (Phase 3 moves this to a site-settings panel with persisted decisions.)

const ALWAYS_ALLOW = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'speaker-selection',
  'window-management',
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
  'storage-access': 'use cookies across sites',
  'top-level-storage-access': 'use cookies across sites',
}

const decisions = new Map<string, boolean>()

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

export function installPermissionHandlers(ses: Session): void {
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL()
    if (ALWAYS_ALLOW.has(permission) || isExtension(url)) return callback(true)
    const what = ASK[permission]
    if (!what) return callback(false)

    const origin = originOf(url)
    const key = `${origin}|${permission}`
    const remembered = decisions.get(key)
    if (remembered !== undefined) return callback(remembered)

    const win = BrowserWindow.fromWebContents(wc) ?? BrowserWindow.getFocusedWindow()
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      message: `${hostOf(origin)} wants to ${what}`,
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    const allowed = response === 0
    decisions.set(key, allowed)
    callback(allowed)
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALWAYS_ALLOW.has(permission) || isExtension(requestingOrigin)) return true
    return decisions.get(`${originOf(requestingOrigin)}|${permission}`) === true
  })
}
