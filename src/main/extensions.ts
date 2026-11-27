import { dialog, session } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore } from 'electron-chrome-web-store'
import { describeExtensionAccess } from '../shared/extension-access'
import type { BrowserShell } from './shell'

const bySession = new Map<string, ElectronChromeExtensions>()
let shell: BrowserShell | null = null

export function setExtensionsShell(s: BrowserShell): void {
  shell = s
}

/** Ask before an extension gets access. Nothing is granted unless you press the confirm button. */
async function confirmAccess(message: string, access: string[], confirm: string): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: [confirm, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail:
      (access.length ? `It will be able to:\n${access.map((line) => `• ${line}`).join('\n')}` : 'It asks for no access to your websites.') +
      '\n\nOnly add extensions you trust: one with access to your websites can see everything you do there.',
  }
  const win = shell && !shell.win.isDestroyed() ? shell.win : null
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return response === 0
}

function requireShell(): BrowserShell {
  if (!shell) throw new Error('browser window not ready')
  return shell
}

/**
 * Chrome extension support (chrome.tabs, action popups, context menus, …) for
 * one session. Bitwarden and other extensions live here. Must be created
 * before extensions are loaded into the session.
 */
export function getExtensions(partition: string): ElectronChromeExtensions {
  const existing = bySession.get(partition)
  if (existing) return existing

  const extensions = new ElectronChromeExtensions({
    session: session.fromPartition(partition),
    async createTab(details) {
      const s = requireShell()
      const tab = s.openTab(details.url ?? 'about:blank', { activate: details.active !== false })
      const wc = s.webContentsForTab(tab.id)
      if (!wc) throw new Error('tab has no view')
      return [wc, s.win]
    },
    selectTab(wc) {
      // chrome.tabs.update({ active: true }) from an extension.
      if (!shell || shell.registeringTab) return
      const id = shell.tabIdForWebContents(wc)
      if (id && shell.activeTab()?.id !== id) shell.activate(id)
    },
    removeTab(wc) {
      const s = requireShell()
      const id = s.tabIdForWebContents(wc)
      if (id) s.removeTab(id)
    },
    async requestPermissions(extension, permissions) {
      // An installed extension asking for more than it was installed with.
      return confirmAccess(`"${extension.name}" wants more access`, describeExtensionAccess(permissions), 'Allow')
    },
  })
  bySession.set(partition, extensions)
  return extensions
}

/**
 * Set up extensions for a session: the chrome.* API layer, then "Add to Chrome"
 * support on chromewebstore.google.com, which also loads already-installed
 * extensions and keeps them updated.
 */
export async function setupExtensions(partition: string): Promise<void> {
  getExtensions(partition)
  await installChromeWebStore({
    session: session.fromPartition(partition),
    // "Add to Chrome" on the Web Store: say what the extension will be able to
    // do and ask first, as Chrome does.
    beforeInstall: async ({ localizedName, manifest }) => {
      const ok = await confirmAccess(`Add "${localizedName || manifest?.name || 'this extension'}"?`, describeExtensionAccess(manifest), 'Add Extension')
      return { action: ok ? 'allow' : 'deny' }
    },
  })
}
