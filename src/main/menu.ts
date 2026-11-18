import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { BrowserShell } from './shell'

/**
 * The application menu doubles as the keyboard-shortcut table: accelerators
 * fire even when focus is inside a web page.
 */
export function installMenu(getShell: () => BrowserShell | null): void {
  const isMac = process.platform === 'darwin'
  const withShell = (fn: (s: BrowserShell) => void) => () => {
    const s = getShell()
    if (s) fn(s)
  }
  const active = (fn: (wc: Electron.WebContents) => void) => withShell((s) => {
    const wc = s.activeWebContents()
    if (wc) fn(wc)
  })

  const tabNumberItems: MenuItemConstructorOptions[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    label: n === 9 ? 'Last Tab' : `Tab ${n}`,
    accelerator: `CmdOrCtrl+${n}`,
    click: withShell((s) => s.selectByIndex(n)),
  }))

  const settings = getShell()?.settings
  const sleepChoices: [number, string][] = [
    [5, 'After 5 Minutes'],
    [15, 'After 15 Minutes'],
    [30, 'After 30 Minutes'],
    [60, 'After 1 Hour'],
    [0, 'Never'],
  ]
  const settingsMenu: MenuItemConstructorOptions = {
    label: 'Performance',
    submenu: [
      {
        label: 'Sleep Inactive Tabs',
        submenu: sleepChoices.map(([minutes, label]) => ({
          label,
          type: 'radio' as const,
          checked: settings?.sleepAfterMinutes === minutes,
          click: withShell((s) => s.updateSettings({ sleepAfterMinutes: minutes })),
        })),
      },
      {
        label: 'Prefer H.264 Video (Less CPU on Intel Macs)',
        type: 'checkbox',
        checked: !!settings?.preferH264,
        click: (item) => getShell()?.updateSettings({ preferH264: item.checked }),
      },
    ],
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: withShell((s) => s.openCommandBar('new')) },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: withShell((s) => s.openCommandBar('edit')) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: withShell((s) => s.reopenClosed()) },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: withShell((s) => {
            const tab = s.activeTab()
            if (tab) s.closeTab(tab.id)
          }),
        },
        { type: 'separator' },
        { label: 'Copy URL', accelerator: 'CmdOrCtrl+Shift+C', click: withShell((s) => s.copyUrl()) },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: withShell((s) => s.toggleSidebar()) },
        { type: 'separator' },
        { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: active((wc) => wc.reload()) },
        { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: active((wc) => wc.reloadIgnoringCache()) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: active((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, click: active((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: active((wc) => wc.setZoomLevel(wc.getZoomLevel() - 0.5)) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: active((wc) => wc.setZoomLevel(0)) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: active((wc) => wc.toggleDevTools()) },
        {
          label: 'Browser UI Developer Tools',
          click: withShell((s) => s.win.webContents.openDevTools({ mode: 'detach' })),
        },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: active((wc) => wc.navigationHistory.goBack()) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: active((wc) => wc.navigationHistory.goForward()) },
        { type: 'separator' },
        {
          label: 'Pin / Unpin Tab',
          accelerator: 'CmdOrCtrl+D',
          click: withShell((s) => {
            const tab = s.activeTab()
            if (tab) s.togglePin(tab.id)
          }),
        },
        { label: 'Clear Today Tabs', accelerator: 'CmdOrCtrl+Shift+K', click: withShell((s) => s.clearToday()) },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: withShell((s) => s.cycle(1)) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: withShell((s) => s.cycle(-1)) },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Alt+Down', visible: false, click: withShell((s) => s.cycle(1)) },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Alt+Up', visible: false, click: withShell((s) => s.cycle(-1)) },
        { type: 'separator' },
        ...tabNumberItems,
      ],
    },
    {
      label: 'Extensions',
      submenu: [
        {
          label: 'Get Extensions (Chrome Web Store)',
          click: withShell((s) => s.openTab('https://chromewebstore.google.com/')),
        },
        {
          label: 'Install Bitwarden',
          click: withShell((s) =>
            s.openTab('https://chromewebstore.google.com/detail/bitwarden-password-manager/nngceckbapebfimnlniiiahkandclblb'),
          ),
        },
      ],
    },
    settingsMenu,
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
