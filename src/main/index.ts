import { app, ipcMain, session } from 'electron'
import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { IPC, type Action, type PersistedState } from '../shared/types'
import { setupExtensions } from './extensions'
import { installMenu } from './menu'
import { installPermissionHandlers } from './permissions'
import { BrowserShell } from './shell'
import { flushState, loadState } from './store'

app.setName('Browser')

// Sites (notably Google sign-in) refuse browsers whose user agent mentions
// Electron or an unknown product. Present a plain Chrome user agent.
app.userAgentFallback = app.userAgentFallback.replace(/\s(\S+)\/(\S+)/g, (token, name: string) =>
  ['AppleWebKit', 'Chrome', 'Safari'].includes(name) ? token : '',
)

let shell: BrowserShell | null = null
let extensionsReady = false
const pendingUrls: string[] = []

function openExternalUrl(url: string) {
  if (shell && extensionsReady) {
    shell.openTab(url)
    if (shell.win.isMinimized()) shell.win.restore()
    shell.win.focus()
  } else {
    pendingUrls.push(url)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => /^https?:\/\//.test(a))
    if (url) openExternalUrl(url)
    else shell?.win.focus()
  })
  // macOS: links opened from other apps when this is the default browser.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    openExternalUrl(url)
  })
  app.whenReady().then(start)
}

function uniquePath(dir: string, filename: string): string {
  const { name, ext } = parse(filename)
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`)
  return candidate
}

function setupSession(partition: string) {
  const ses = session.fromPartition(partition)
  ses.setUserAgent(app.userAgentFallback)
  installPermissionHandlers(ses)
  ses.setSpellCheckerLanguages(['en-US'])
  // Save downloads straight to ~/Downloads, like other browsers.
  ses.on('will-download', (_e, item) => {
    item.setSavePath(uniquePath(app.getPath('downloads'), item.getFilename()))
    item.once('done', (_ev, state) => {
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(item.getSavePath())
    })
  })
}

const H264_PRELOAD_ID = 'prefer-h264'

/** Turn the "prefer H.264 video" page script on or off for a session (applies to new page loads). */
function applyH264(partition: string, on: boolean) {
  const ses = session.fromPartition(partition)
  const registered = ses.getPreloadScripts().some((p) => p.id === H264_PRELOAD_ID)
  if (on && !registered) {
    ses.registerPreloadScript({ id: H264_PRELOAD_ID, type: 'frame', filePath: join(__dirname, '../preload/h264.js') })
  } else if (!on && registered) {
    ses.unregisterPreloadScript(H264_PRELOAD_ID)
  }
}

async function start() {
  const state = loadState()
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`

  // Our own UI loads extension icons via crx:// in the default session.
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  for (const space of state.spaces) {
    setupSession(space.partition)
    applyH264(space.partition, state.settings.preferH264)
  }

  ipcMain.handle(IPC.getState, (event) => {
    if (!shell || !shell.isUIWebContents(event.sender)) return null
    return shell.snapshot()
  })
  ipcMain.on(IPC.action, (event, action: Action) => {
    if (!shell || !shell.isUIWebContents(event.sender)) return
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return
    shell.handleAction(action)
  })

  const createShell = (s: PersistedState) => {
    const created = new BrowserShell(s, rendererUrl)
    created.onSettingsChanged = (settings) => {
      for (const space of s.spaces) applyH264(space.partition, settings.preferH264)
      installMenu(() => shell)
    }
    created.win.on('closed', () => {
      if (shell === created) shell = null
    })
    // Automated smoke tests drive the shell directly.
    if (process.env.BROWSER_E2E) Object.assign(globalThis, { __shell: created })
    return created
  }

  // Show the window right away; pages wait until extensions (e.g. Bitwarden)
  // are loaded so their content scripts are in place.
  shell = createShell(state)
  installMenu(() => shell)

  for (const space of state.spaces) {
    try {
      await setupExtensions(space.partition)
    } catch (err) {
      console.error('Extension setup failed:', err)
    }
  }

  if (!shell) return
  shell.restoreActiveTab()
  // First run: open something useful.
  if (!state.tabs.length && !pendingUrls.length) {
    shell.openTab('https://chromewebstore.google.com/detail/bitwarden-password-manager/nngceckbapebfimnlniiiahkandclblb')
  }
  extensionsReady = true
  for (const url of pendingUrls.splice(0)) shell.openTab(url)

  app.on('activate', () => {
    if (!shell) {
      shell = createShell(loadState())
      shell.restoreActiveTab()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => flushState())
