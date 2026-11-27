import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, shell as electronShell, systemPreferences, type IpcMainEvent, type WebContents, type WebFrameMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LOGINS, loginOrigin, parsePasswordCsv, toPasswordCsv } from '../shared/passwords'
import type { LoginInfo, LoginsOverview } from '../shared/types'
import type { BrowserDB } from './db'

// Saved passwords.
//
// They live in the browser's database on this Mac and nowhere else. Each
// password is encrypted before it is written, with a key that macOS keeps in
// your keychain (Electron's safeStorage); the database file alone is no use to
// anyone. If this computer offers no such encryption, nothing is saved at all.
//
// A password is tied to the exact site it was saved for and is offered only
// there, and only put into a page after you pick it from the menu: a page
// can't make the browser hand one over.

/** What the window tells us about itself. */
export interface PasswordsHost {
  /** The window a page is shown in, and where the page's top-left corner is inside it. */
  locate(wc: WebContents): { window: BrowserWindow; x: number; y: number } | null
  /** Is "Offer to save passwords" on? */
  offersToSave(): boolean
  /** Open the Passwords screen. */
  showPasswords(): void
}

const MAX_FIELD = 2000
/** A user name typed in the first step of a two-step sign-in is kept this long for the second step. */
const USERNAME_STEP_MS = 5 * 60_000
/** A copied password is wiped from the clipboard after this long, unless you copied something else. */
const CLIPBOARD_MS = 60_000

const text = (value: unknown) => (typeof value === 'string' && value.length <= MAX_FIELD ? value : null)
const hostOf = (origin: string) => origin.replace(/^https?:\/\//, '')

export class Passwords {
  host: PasswordsHost | null = null
  /** The list changed: refresh the Passwords screen if it is open. */
  onChange: () => void = () => {}

  private usernameStep = new WeakMap<WebContents, { origin: string; username: string; at: number }>()
  /** One question at a time; a second sign-in while one is showing is not asked about. */
  private asking = false

  constructor(private db: BrowserDB | null) {
    ipcMain.on(LOGINS.focus, (event, at) => this.offer(event, at))
    ipcMain.on(LOGINS.submit, (event, login) => void this.submitted(event, login).catch((err) => console.error('Passwords:', err)))
    ipcMain.on(LOGINS.username, (event, username) => this.rememberUsername(event, username))
  }

  /** Can passwords be stored safely on this computer? */
  available(): boolean {
    return !!this.db && safeStorage.isEncryptionAvailable()
  }

  private encrypt(password: string): Promise<Buffer> {
    return safeStorage.encryptStringAsync(password)
  }

  private async decrypt(id: number): Promise<string | null> {
    const secret = this.db?.loginSecret(id)
    if (!secret) return null
    return (await safeStorage.decryptStringAsync(Buffer.from(secret))).result
  }

  /**
   * The site a frame's passwords belong to. Taken from what the browser knows
   * about the frame, not from anything the page says. A frame inside a page
   * counts only if it is the same site as the page: a sign-in form from
   * elsewhere, embedded in a page, is exactly what a phishing page would do.
   */
  private originOf(frame: WebFrameMain | null): string | null {
    if (!frame || frame.isDestroyed()) return null
    const origin = loginOrigin(frame.url)
    if (!origin) return null
    if (frame.parent && loginOrigin(frame.top?.url ?? '') !== origin) return null
    return origin
  }

  // ───────────────────────────── filling in ─────────────────────────────

  /** A sign-in field got the focus: show the logins saved for this site, if any. */
  private offer(event: IpcMainEvent, at: unknown) {
    const frame = event.senderFrame
    const origin = this.originOf(frame)
    if (!origin || !this.available()) return
    const logins = this.db!.loginsFor(origin)
    if (!logins.length) return

    const menu = Menu.buildFromTemplate([
      ...logins.map((login) => ({
        label: login.username || 'No user name',
        click: () => void this.fill(frame!, login).catch((err) => console.error('Passwords:', err)),
      })),
      { type: 'separator' as const },
      { label: 'Manage Passwords…', click: () => this.host?.showPasswords() },
    ])
    const place = this.host?.locate(event.sender)
    const point = at as { x?: unknown; y?: unknown; top?: unknown } | null
    // Under the field when we know where the page is; otherwise at the pointer.
    if (place && point && point.top === true && typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x + point.y)) {
      menu.popup({ window: place.window, x: Math.round(place.x + point.x), y: Math.round(place.y + point.y) })
    } else {
      menu.popup(place ? { window: place.window } : {})
    }
  }

  private async fill(frame: WebFrameMain, login: LoginInfo) {
    // The page may have moved on while the menu was open: check it is still the same site.
    if (this.originOf(frame) !== login.origin) return
    const password = await this.decrypt(login.id)
    if (password === null || frame.isDestroyed()) return
    frame.send(LOGINS.fill, { username: login.username, password })
    this.db!.touchLogin(login.id)
  }

  // ───────────────────────────── saving ─────────────────────────────

  private rememberUsername(event: IpcMainEvent, value: unknown) {
    const origin = this.originOf(event.senderFrame)
    const username = text(value)
    if (origin && username) this.usernameStep.set(event.sender, { origin, username, at: Date.now() })
  }

  /** A form with a password in it was sent: offer to save it, or to update the one we have. */
  private async submitted(event: IpcMainEvent, login: unknown) {
    const wc = event.sender
    const origin = this.originOf(event.senderFrame)
    const sent = login as { username?: unknown; password?: unknown } | null
    const password = text(sent?.password)
    let username = text(sent?.username) ?? ''
    if (!origin || !password || !this.available() || !this.host?.offersToSave()) return
    // Private windows fill in saved passwords but never save new ones.
    if (!wc.session.isPersistent()) return
    if (this.db!.isNeverSave(origin)) return

    const step = this.usernameStep.get(wc)
    if (!username && step && step.origin === origin && Date.now() - step.at < USERNAME_STEP_MS) username = step.username

    const saved = this.db!.loginsFor(origin)
    const same = saved.find((l) => l.username === username)
    if (same) {
      if ((await this.decrypt(same.id)) === password) return this.db!.touchLogin(same.id)
    } else if (!username) {
      // No user name to go by: don't add a second copy of a password we already have for this site.
      for (const l of saved) if ((await this.decrypt(l.id)) === password) return this.db!.touchLogin(l.id)
    }

    if (this.asking) return
    this.asking = true
    try {
      // Let the page get on with signing in before a question appears over it.
      await new Promise((resolve) => setTimeout(resolve, 700))
      const window = this.host.locate(wc)?.window
      const options = {
        type: 'question' as const,
        message: same ? `Update the saved password for ${hostOf(origin)}?` : `Save this password for ${hostOf(origin)}?`,
        detail: `${username ? `User name: ${username}\n\n` : ''}Saved on this Mac only, encrypted with a key in your keychain.`,
        buttons: same ? ['Update', 'Not Now'] : ['Save', 'Not Now', 'Never for This Site'],
        defaultId: 0,
        cancelId: 1,
      }
      const { response } = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
      if (response === 0) {
        this.db!.saveLogin(origin, username, await this.encrypt(password))
        this.onChange()
      } else if (response === 2) {
        this.db!.setNeverSave(origin, true)
        this.onChange()
      }
    } finally {
      this.asking = false
    }
  }

  // ───────────────────────────── the Passwords screen ─────────────────────────────

  overview(): LoginsOverview {
    const available = this.available()
    return { available, logins: available ? this.db!.listLogins() : [], never: this.db?.listNeverSave() ?? [] }
  }

  /**
   * Looking at or copying a password needs the Mac's owner: Touch ID where the
   * Mac has it. (Macs without it have no such check to offer.)
   */
  private async confirmOwner(reason: string): Promise<boolean> {
    if (process.platform !== 'darwin' || !systemPreferences.canPromptTouchID()) return true
    try {
      await systemPreferences.promptTouchID(reason)
      return true
    } catch {
      return false
    }
  }

  async reveal(id: number): Promise<string | null> {
    if (!this.available() || !(await this.confirmOwner('show a saved password'))) return null
    return this.decrypt(id)
  }

  async copy(id: number): Promise<void> {
    if (!this.available() || !(await this.confirmOwner('copy a saved password'))) return
    const password = await this.decrypt(id)
    if (password === null) return
    await clipboard.writeText(password)
    setTimeout(() => {
      void clipboard.readText().then((now) => now === password && clipboard.clear())
    }, CLIPBOARD_MS)
  }

  delete(id: number) {
    this.db?.deleteLogin(id)
    this.onChange()
  }

  /** Undo "Never for This Site". */
  allowSaving(origin: string) {
    this.db?.setNeverSave(origin, false)
    this.onChange()
  }

  // ───────────────────────────── import ─────────────────────────────

  /** Add the logins from a password file's text. A login already saved for the same site and user name is replaced. */
  async importCsv(csv: string): Promise<{ imported: number; skipped: number }> {
    if (!this.available()) return { imported: 0, skipped: 0 }
    const { logins, skipped } = parsePasswordCsv(csv)
    for (const login of logins) this.db!.saveLogin(login.origin, login.username, await this.encrypt(login.password))
    if (logins.length) this.onChange()
    return { imported: logins.length, skipped }
  }

  /** Pick a password file exported from Arc or Chrome and import it. */
  /**
   * A backup of every saved password, for the day the keychain key is gone
   * (new Mac, keychain reset): without it, nothing can unlock what is stored
   * here. The file is plain text, so it asks who you are first and says what
   * to do with the file.
   */
  async exportToFile(window: BrowserWindow): Promise<void> {
    if (!this.available()) return
    const logins = this.db!.listLogins()
    if (!logins.length) {
      await dialog.showMessageBox(window, { type: 'info', message: 'There are no saved passwords to export' })
      return
    }
    if (!(await this.confirmOwner('export your saved passwords'))) return
    const go = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Choose Where to Save…', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Export ${logins.length} password${logins.length === 1 ? '' : 's'} to a file?`,
      detail:
        'The file holds every password as plain text: anyone who can open it can read them.\n\n' +
        'Use it to put them somewhere safe (import the file into Bitwarden, or keep it on an encrypted disk), then move the file to the Trash and empty the Trash. Don’t leave it in Downloads, Documents or a synced folder.',
    })
    if (go.response !== 0) return
    const picked = await dialog.showSaveDialog(window, { title: 'Export Passwords', defaultPath: join(app.getPath('documents'), 'Browser Passwords.csv'), filters: [{ name: 'Password file', extensions: ['csv'] }] })
    if (picked.canceled || !picked.filePath) return
    try {
      const rows: { origin: string; username: string; password: string }[] = []
      for (const login of logins) {
        const password = await this.decrypt(login.id)
        if (password !== null) rows.push({ origin: login.origin, username: login.username, password })
      }
      // Readable by you only.
      await writeFile(picked.filePath, toPasswordCsv(rows), { mode: 0o600 })
      await dialog.showMessageBox(window, { type: 'info', message: `Exported ${rows.length} password${rows.length === 1 ? '' : 's'}`, detail: 'Remember to delete the file once the passwords are somewhere safe.' })
    } catch (err) {
      await dialog.showMessageBox(window, { type: 'error', message: 'The passwords couldn’t be exported', detail: err instanceof Error ? err.message : String(err) })
    }
  }

  async importFromFile(window: BrowserWindow): Promise<void> {
    if (!this.available()) {
      await dialog.showMessageBox(window, { type: 'warning', message: 'Passwords can’t be saved on this computer', detail: 'There is no keychain to encrypt them with.' })
      return
    }
    const picked = await dialog.showOpenDialog(window, {
      title: 'Import Passwords',
      message: 'Choose the password file exported from Arc or Chrome',
      properties: ['openFile'],
      filters: [{ name: 'Password export', extensions: ['csv'] }],
    })
    const path = picked.filePaths[0]
    if (picked.canceled || !path) return
    let result: { imported: number; skipped: number }
    try {
      result = await this.importCsv(await readFile(path, 'utf8'))
    } catch (err) {
      await dialog.showMessageBox(window, { type: 'error', message: 'That file couldn’t be read', detail: err instanceof Error ? err.message : String(err) })
      return
    }
    if (!result.imported) {
      await dialog.showMessageBox(window, {
        type: 'warning',
        message: 'No passwords found in that file',
        detail: 'It should be the file Arc or Chrome saves from “Export passwords”, with columns named url, username and password.',
      })
      return
    }
    const { response } = await dialog.showMessageBox(window, {
      type: 'info',
      message: `Imported ${result.imported} password${result.imported === 1 ? '' : 's'}`,
      detail:
        (result.skipped ? `${result.skipped} entr${result.skipped === 1 ? 'y was' : 'ies were'} skipped (no password, or not for a secure website).\n\n` : '') +
        'The file you imported still holds every password as plain text. Unless you need it, move it to the Trash, then empty the Trash.',
      buttons: ['Move File to Trash', 'Keep File'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) await electronShell.trashItem(path).catch(() => {})
  }
}
