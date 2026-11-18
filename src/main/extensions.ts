import { session } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore } from 'electron-chrome-web-store'
import type { BrowserShell } from './shell'

const bySession = new Map<string, ElectronChromeExtensions>()
let shell: BrowserShell | null = null

export function setExtensionsShell(s: BrowserShell): void {
  shell = s
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
    async requestPermissions() {
      // Extensions only come from the Web Store, installed by you.
      return true
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
  await installChromeWebStore({ session: session.fromPartition(partition) })
}
