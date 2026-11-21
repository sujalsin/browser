import { app, components, ipcMain, nativeTheme, session } from 'electron'
import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { IPC, type Action, type PersistedState, type Query } from '../shared/types'
import { setupExtensions } from './extensions'
import { installMenu } from './menu'
import { Downloads } from './downloads'
import { installPermissionHandlers, loadPermissions } from './permissions'
import { BrowserDB } from './db'
import { BrowserShell } from './shell'
import { Shields } from './shields'
import { flushState, loadState } from './store'

app.setName('Browser')

// Sites (notably Google sign-in) refuse browsers whose user agent mentions
// Electron or an unknown product. Present a plain Chrome user agent.
app.userAgentFallback = app.userAgentFallback.replace(/\s(\S+)\/(\S+)/g, (token, name: string) =>
  ['AppleWebKit', 'Chrome', 'Safari'].includes(name) ? token : '',
)

let shell: BrowserShell | null = null
let db: BrowserDB | null = null
let extensionsReady = false
const pendingUrls: string[] = []

function openExternalUrl(url: string) {
  if (!shell || !extensionsReady) {
    pendingUrls.push(url)
    return
  }
  // Like Arc: links from other apps open in a Little Arc window (setting).
  if (shell.settings.littleArcForLinks) {
    shell.openLittle(url)
    return
  }
  shell.openTab(url)
  if (shell.win.isMinimized()) shell.win.restore()
  shell.win.focus()
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
  // Password-protected sites and proxies: without this, Electron just fails the request.
  app.on('login', (event, _wc, _details, authInfo, callback) => {
    if (!shell) return
    event.preventDefault()
    shell.requestAuth({ host: authInfo.port ? `${authInfo.host}:${authInfo.port}` : authInfo.host, realm: authInfo.realm, isProxy: authInfo.isProxy }, callback)
  })
  app.whenReady().then(start)
}

/** Paths of downloads in progress, so two at once never get the same name. */
const reservedPaths = new Set<string>()

function uniquePath(dir: string, filename: string): string {
  const { name, ext } = parse(filename)
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate) || reservedPaths.has(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`)
  reservedPaths.add(candidate)
  return candidate
}

function setupSession(partition: string, downloads: Downloads) {
  const ses = session.fromPartition(partition)
  ses.setUserAgent(app.userAgentFallback)
  installPermissionHandlers(ses, partition)
  ses.setSpellCheckerLanguages(['en-US'])
  // Save downloads straight to ~/Downloads, like other browsers.
  ses.on('will-download', (_e, item) => {
    const path = uniquePath(app.getPath('downloads'), item.getFilename())
    item.setSavePath(path)
    downloads.track(item, path)
    item.once('done', () => reservedPaths.delete(path))
  })
}

/**
 * Widevine (the copy-protection module Netflix, Spotify, Disney+ … require).
 * This Electron build installs and updates it through Chromium's component
 * updater. Installed copies are ready almost instantly; a first-time download
 * continues in the background, so startup never waits longer than `maxWaitMs`.
 */
function widevineReady(maxWaitMs: number): Promise<void> {
  // `components` only exists in the Widevine-enabled Electron build.
  if (!components) return Promise.resolve()
  const ready = components
    .whenReady()
    .then(() => undefined)
    .catch((err: unknown) => console.warn('Widevine is not available yet (protected video will not play):', err))
  return Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs))])
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
  // Light/dark for the browser UI and for pages that support it.
  nativeTheme.themeSource = state.settings.appearance
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`

  // History, downloads and site permissions. A broken database must not stop the browser.
  try {
    db = new BrowserDB(join(app.getPath('userData'), 'Browser.sqlite'))
    // Keep 90 days of history, like Chrome; do it once startup has settled.
    setTimeout(() => db?.prune(Date.now() - 90 * 86_400_000), 30_000)
  } catch (err) {
    console.error('Could not open the history database:', err)
  }

  loadPermissions(db)
  const downloads = new Downloads(db)
  downloads.onChange = () => shell?.downloadsChanged()
  downloads.onRetry = (url) => shell?.activeWebContents()?.downloadURL(url)

  // Shields read settings from whichever window state is current.
  const shields = new Shields(() => (shell ? shell.shieldsSettings : state.shields))

  // Our own UI loads extension icons via crx:// in the default session.
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)

  // One-time setup per profile (session partition); several spaces can share one.
  const prepared = new Map<string, Promise<void>>()
  const prepareSession = (partition: string): Promise<void> => {
    let ready = prepared.get(partition)
    if (!ready) {
      setupSession(partition, downloads)
      applyH264(partition, (shell?.settings ?? state.settings).preferH264)
      shields.attach(session.fromPartition(partition))
      ready = setupExtensions(partition).catch((err) => console.error('Extension setup failed:', err))
      prepared.set(partition, ready)
    }
    return ready
  }
  const startupSessions = [...new Set(state.spaces.map((sp) => sp.partition))].map(prepareSession)

  ipcMain.handle(IPC.getState, (event) => {
    if (!shell || !shell.isUIWebContents(event.sender)) return null
    return shell.snapshot()
  })
  ipcMain.handle(IPC.query, (event, q: Query) => {
    if (!shell || !shell.isUIWebContents(event.sender) || !q || typeof q.type !== 'string') return null
    return shell.query(q)
  })
  ipcMain.on(IPC.action, (event, action: Action) => {
    if (!shell || !action || typeof action !== 'object' || typeof action.type !== 'string') return
    const little = shell.littleFor(event.sender)
    if (little) return shell.handleLittleAction(little, action)
    if (!shell.isUIWebContents(event.sender)) return
    shell.handleAction(action)
  })

  const createShell = (s: PersistedState) => {
    const created = new BrowserShell(s, rendererUrl)
    created.attachShields(shields)
    created.db = db
    created.downloads = downloads
    created.prepareSession = prepareSession
    created.onSettingsChanged = (settings) => {
      nativeTheme.themeSource = settings.appearance
      for (const partition of new Set(s.spaces.map((sp) => sp.partition))) applyH264(partition, settings.preferH264)
      installMenu(() => shell)
    }
    created.win.on('closed', () => {
      if (shell === created) shell = null
    })
    // Automated smoke tests drive the shell directly.
    if (process.env.BROWSER_E2E) Object.assign(globalThis, { __shell: created, __shields: shields })
    return created
  }

  // Show the window right away; pages wait until extensions (e.g. Bitwarden)
  // are loaded so their content scripts are in place.
  shell = createShell(state)
  installMenu(() => shell)

  // Load extensions and the cached ad-block engine in parallel, before any page loads.
  await Promise.all([shields.init().catch((err) => console.error('Shields init failed:', err)), widevineReady(3000), ...startupSessions])

  if (!shell) return
  shell.restoreActiveTab()
  // First run: open something useful.
  if (!state.tabs.length && !pendingUrls.length) {
    shell.openTab('https://chromewebstore.google.com/detail/bitwarden-password-manager/nngceckbapebfimnlniiiahkandclblb')
  }
  extensionsReady = true
  for (const url of pendingUrls.splice(0)) openExternalUrl(url)

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
app.on('will-quit', () => {
  try {
    db?.close()
  } catch {
    /* already closed */
  }
  db = null
})
