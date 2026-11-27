import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { isInterfaceUrl } from '../shared/interface-url'

/**
 * Keep one of the browser's own interface documents where it is.
 *
 * Nothing in the interface navigates, opens windows or embeds pages, so all
 * three are simply refused. Without this, anything that managed to send the
 * interface to a website would hand that website the interface's controls.
 */
export function lockInterface(wc: WebContents, rendererUrl: string): void {
  const stay = (event: { preventDefault(): void }, url: string) => {
    // Reloading itself is fine (the development server does it after every edit).
    if (!isInterfaceUrl(url, rendererUrl)) event.preventDefault()
  }
  wc.on('will-navigate', (event, url) => stay(event, url))
  wc.on('will-frame-navigate', (event) => stay(event, event.url))
  wc.on('will-redirect', (event, url) => stay(event, url))
  wc.on('will-attach-webview', (event) => event.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/**
 * Second lock on the same door: a message asking for the interface's controls
 * is only honoured when it comes from the top document of an interface view
 * AND that document is still our own file.
 */
export function fromInterface(event: IpcMainEvent | IpcMainInvokeEvent, rendererUrl: string): boolean {
  const frame = event.senderFrame
  return !!frame && !frame.parent && isInterfaceUrl(frame.url, rendererUrl)
}
