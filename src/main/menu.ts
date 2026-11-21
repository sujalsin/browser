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

  const archiveChoices: [number, string][] = [
    [12, 'After 12 Hours'],
    [24, 'After 24 Hours'],
    [24 * 7, 'After 7 Days'],
    [24 * 30, 'After 30 Days'],
    [0, 'Never'],
  ]
  const spaceNumberItems: MenuItemConstructorOptions[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    label: `Space ${n}`,
    accelerator: `Ctrl+${n}`,
    click: withShell((s) => s.selectSpaceByIndex(n)),
  }))

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
    ...(isMac
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: withShell((s) => s.openLibrary('settings')) },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: withShell((s) => s.openCommandBar('new')) },
        { label: 'New Little Arc Window', accelerator: 'Alt+CmdOrCtrl+N', click: withShell((s) => void s.openLittle()) },
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
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: withShell((s) => s.print()) },
        { type: 'separator' },
        { label: 'History', accelerator: 'CmdOrCtrl+Y', click: withShell((s) => s.openLibrary('history')) },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: withShell((s) => s.openLibrary('downloads')) },
        { label: 'Import from Arc…', click: withShell((s) => s.handleAction({ type: 'arc.import' })) },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              { label: 'Settings', accelerator: 'Ctrl+,', click: withShell((s) => s.openLibrary('settings')) },
              { role: 'quit' as const },
            ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: withShell((s) => s.openFind()) },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: withShell((s) => s.findAgain(true)) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: withShell((s) => s.findAgain(false)) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: withShell((s) => s.toggleSidebar()) },
        { type: 'separator' },
        { label: 'Split View with New Tab', accelerator: 'Ctrl+Shift+=', click: withShell((s) => s.splitWithNewTab()) },
        {
          label: 'Exit Split View',
          accelerator: 'Ctrl+Shift+-',
          click: withShell((s) => {
            const id = s.activeSplitId()
            if (id) s.exitSplit(id)
          }),
        },
        {
          label: 'Swap Split Sides',
          click: withShell((s) => {
            const id = s.activeSplitId()
            if (id) s.swapSplit(id)
          }),
        },
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
        { label: 'View Page Source', accelerator: 'Alt+CmdOrCtrl+U', click: withShell((s) => s.viewSource()) },
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
        {
          label: 'Add to / Remove from Favorites',
          click: withShell((s) => {
            const tab = s.activeTab()
            if (tab) s.toggleFavorite(tab.id)
          }),
        },
        { type: 'separator' },
        { label: 'Tidy Tabs', accelerator: 'CmdOrCtrl+Shift+Y', click: withShell((s) => s.tidy()) },
        { label: 'Clear Today Tabs', accelerator: 'CmdOrCtrl+Shift+K', click: withShell((s) => s.clearToday()) },
        {
          label: 'Archive Today Tabs',
          submenu: archiveChoices.map(([hours, label]) => ({
            label,
            type: 'radio' as const,
            checked: settings?.archiveAfterHours === hours,
            click: withShell((s) => s.updateSettings({ archiveAfterHours: hours })),
          })),
        },
        { type: 'separator' },
        { label: 'New Folder', click: withShell((s) => s.newFolder('pinned')) },
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
      label: 'Spaces',
      submenu: [
        { label: 'Next Space', accelerator: 'CmdOrCtrl+Alt+Right', click: withShell((s) => s.cycleSpace(1)) },
        { label: 'Previous Space', accelerator: 'CmdOrCtrl+Alt+Left', click: withShell((s) => s.cycleSpace(-1)) },
        { type: 'separator' },
        ...spaceNumberItems,
        { type: 'separator' },
        { label: 'New Space', click: withShell((s) => void s.createSpace(false)) },
        { label: 'New Space with Separate Profile', click: withShell((s) => void s.createSpace(true)) },
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
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Task Manager', click: withShell((s) => s.openLibrary('tasks')) },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
