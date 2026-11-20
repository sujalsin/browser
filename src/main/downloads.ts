import { app, shell, type DownloadItem } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { DownloadInfo } from '../shared/types'
import type { BrowserDB } from './db'

const KEEP = 50

export type DownloadOp = 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove' | 'retry'

/** Tracks downloads from every profile, keeps the recent list, persists it. */
export class Downloads {
  private live = new Map<string, DownloadItem>()
  private list: DownloadInfo[]
  /** Something changed (progress, new, done): refresh the UI. */
  onChange: () => void = () => {}
  /** A download should be retried from its URL (handled by a tab's session). */
  onRetry: (url: string) => void = () => {}

  constructor(private db: BrowserDB | null) {
    this.list = safe(() => db?.listDownloads(KEEP)) ?? []
    // Anything still "in progress" from last time was cut off when the app quit.
    for (const d of this.list) if (d.state === 'progressing') d.state = 'interrupted'
  }

  recent(): DownloadInfo[] {
    return this.list
  }

  track(item: DownloadItem, savePath: string) {
    const info: DownloadInfo = {
      id: randomUUID(),
      url: item.getURL(),
      filename: basename(savePath),
      path: savePath,
      state: 'progressing',
      paused: false,
      received: 0,
      total: item.getTotalBytes(),
      startedAt: Date.now(),
    }
    this.live.set(info.id, item)
    this.list.unshift(info)
    this.list.length = Math.min(this.list.length, KEEP)
    this.save(info)

    item.on('updated', (_e, state) => {
      info.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      info.paused = item.isPaused()
      info.received = item.getReceivedBytes()
      info.total = item.getTotalBytes()
      this.onChange()
    })
    item.once('done', (_e, state) => {
      info.state = state
      info.paused = false
      info.received = item.getReceivedBytes()
      info.endedAt = Date.now()
      this.live.delete(info.id)
      this.save(info)
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(savePath)
      this.onChange()
    })
    this.onChange()
  }

  act(id: string, op: DownloadOp) {
    const info = this.list.find((d) => d.id === id)
    if (!info) return
    const item = this.live.get(id)
    switch (op) {
      case 'pause':
        item?.pause()
        break
      case 'resume':
        if (item?.canResume()) item.resume()
        break
      case 'cancel':
        item?.cancel()
        break
      case 'open':
        if (existsSync(info.path)) void shell.openPath(info.path)
        else this.markMissing(info)
        break
      case 'show':
        if (existsSync(info.path)) shell.showItemInFolder(info.path)
        else this.markMissing(info)
        break
      case 'retry':
        this.onRetry(info.url)
        break
      case 'remove':
        if (item) return // remove only finished downloads from the list
        this.list = this.list.filter((d) => d.id !== id)
        safe(() => this.db?.deleteDownload(id))
        break
    }
    this.onChange()
  }

  /** Remove finished downloads from the list (files stay on disk). */
  clear() {
    for (const d of this.list.filter((d) => !this.live.has(d.id))) safe(() => this.db?.deleteDownload(d.id))
    this.list = this.list.filter((d) => this.live.has(d.id))
    this.onChange()
  }

  private markMissing(info: DownloadInfo) {
    info.state = 'cancelled'
    info.filename = `${info.filename} (deleted)`
    this.save(info)
  }

  private save(info: DownloadInfo) {
    safe(() => this.db?.saveDownload(info))
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (err) {
    console.error('Downloads storage error:', err)
    return undefined
  }
}
