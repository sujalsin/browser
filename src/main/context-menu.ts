import { languageName } from '../shared/translate'
import { Menu, clipboard, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { BrowserShell } from './shell'

/** Right-click menu for web pages (Electron has none by default). */
export function attachWebContextMenu(shell: BrowserShell, wc: WebContents): void {
  wc.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    const tabId = shell.tabIdForWebContents(wc)

    if (params.linkURL) {
      items.push(
        { label: 'Open Link in New Tab', click: () => shell.openTab(params.linkURL, { activate: false, afterTabId: tabId }) },
        { label: 'Open Link in Peek', click: () => shell.openPreview(params.linkURL, shell.partitionForWebContents(wc)) },
        { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      )
    }

    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Open Image in New Tab', click: () => shell.openTab(params.srcURL, { afterTabId: tabId }) },
        { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
        { label: 'Save Image As…', click: () => wc.downloadURL(params.srcURL) },
        { type: 'separator' },
      )
    }

    if (params.isEditable) {
      // Spelling suggestions first, like Chrome.
      for (const s of params.dictionarySuggestions.slice(0, 4)) {
        items.push({ label: s, click: () => wc.replaceMisspelling(s) })
      }
      if (params.misspelledWord) {
        items.push(
          {
            label: 'Add to Dictionary',
            click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
          },
          { type: 'separator' },
        )
      }
      items.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste },
        { role: 'selectAll' },
        { type: 'separator' },
      )
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim()
      const short = text.length > 24 ? `${text.slice(0, 24)}…` : text
      items.push(
        { role: 'copy' },
        { label: `Search for “${short}”`, click: () => shell.navigate(text, 'new') },
        { type: 'separator' },
      )
    }

    if (!params.linkURL && !params.isEditable && !params.selectionText) {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
      )
      if (shell.tabIdForWebContents(wc) === shell.activeTab()?.id && /^https?:/.test(wc.getURL())) {
        items.push(
          shell.isTranslated(wc)
            ? { label: 'Show Original', click: () => void shell.showOriginal() }
            : { label: `Translate to ${languageName(shell.settings.translateTo)}`, click: () => void shell.translateActive() },
          { type: 'separator' },
        )
      }
    }

    const extItems = ElectronChromeExtensions.fromSession(wc.session)?.getContextMenuItems(wc, params) ?? []
    if (extItems.length) {
      items.push(...(extItems as unknown as MenuItemConstructorOptions[]))
      items.push({ type: 'separator' })
    }

    if (/^https?:/.test(wc.getURL()) && !params.isEditable && !shell.isPrivatePage(wc)) {
      items.push({ label: 'Hide This Element (Zap)', click: () => void shell.zapAt(wc, params.x, params.y) }, { type: 'separator' })
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) })

    Menu.buildFromTemplate(items).popup()
  })
}
