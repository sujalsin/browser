import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import { IPC, type Action, type LittleState, type Query, type UIState } from '../shared/types'

// Defines the <browser-action-list> element used to show extension buttons.
injectBrowserAction()

const api = {
  getState: (): Promise<UIState | null> => ipcRenderer.invoke(IPC.getState),
  dispatch: (action: Action): void => ipcRenderer.send(IPC.action, action),
  query: <T = unknown>(q: Query): Promise<T> => ipcRenderer.invoke(IPC.query, q),
  onState: (cb: (state: UIState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: UIState) => cb(state)
    ipcRenderer.on(IPC.state, listener)
    return () => ipcRenderer.removeListener(IPC.state, listener)
  },
  onLittleState: (cb: (state: LittleState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: LittleState) => cb(state)
    ipcRenderer.on(IPC.littleState, listener)
    return () => ipcRenderer.removeListener(IPC.littleState, listener)
  },
}

export type BrowserApi = typeof api

contextBridge.exposeInMainWorld('browser', api)
