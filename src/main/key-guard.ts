import { app, dialog, safeStorage, WebContentsView, type Session } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { KEY_FILE, newKeyRecord, parseKeyRecord, verifyKey, type KeyCrypto, type KeyRecord } from './key-check'

/**
 * Only the built Mac app locks cookies (see build/after-pack.cjs), so only it
 * needs the check. The automated tests switch it on for a development copy.
 */
const testing = !app.isPackaged && process.env.BROWSER_KEY_GUARD === '1'
const ACTIVE = (app.isPackaged && process.platform === 'darwin') || testing

const crypto: KeyCrypto = {
  encrypt: (text) => safeStorage.encryptStringAsync(text),
  decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result,
}

const RESAVE_ATTEMPTS = 3
const RESAVE_TIMEOUT_MS = 20_000

export class KeyGuard {
  readonly active = ACTIVE
  private record: KeyRecord | null = null
  private readonly file = join(app.getPath('userData'), KEY_FILE)

  /**
   * Check the key before any profile is opened. Returns false if the browser
   * must not continue (you chose Quit); nothing has been touched in that case.
   */
  async open(): Promise<boolean> {
    if (!this.active) return true
    // The Linux test machine has no keychain; use Electron's stand-in there.
    if (testing && process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
    this.record = parseKeyRecord(existsSync(this.file) ? readFileSync(this.file, 'utf8') : null)
    const verdict = await verifyKey(this.record, crypto).catch(() => 'unavailable' as const)
    if (verdict === 'ok') return true

    if (verdict === 'first') {
      try {
        this.record = await newKeyRecord(crypto)
        this.save()
        return true
      } catch {
        // No key on the very first use: fall through to the same question.
      }
    }

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Quit', 'Start Fresh…'],
      defaultId: 0,
      cancelId: 0,
      message: verdict === 'different' ? 'The key in your keychain is not the one this profile was locked with' : 'The browser could not get its key from the macOS keychain',
      detail:
        'Your sign-ins and the passwords saved in the browser are locked with a key that macOS keeps in the keychain, under “Browser Safe Storage”.\n\n' +
        (verdict === 'different'
          ? 'This happens after the keychain was reset, or when the profile was copied from another Mac. If you have a backup of your keychain, quit and restore it first.'
          : 'This usually means the question macOS just asked was answered with “Deny”, or the keychain is locked. Quit, open the browser again, enter your Mac password and choose “Always Allow”.') +
        '\n\nNothing has been changed or lost so far. “Start Fresh” continues with the key as it is now: you will be signed out of websites, and passwords saved in the browser can no longer be read.',
    })
    if (response !== 1) return false
    const sure = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel and Quit', 'Sign Me Out and Continue'],
      defaultId: 0,
      cancelId: 0,
      message: 'Start fresh?',
      detail: 'You will be signed out of all websites in this browser, and the passwords saved in it become unreadable for good. Bitwarden is not affected. This cannot be undone.',
    })
    if (sure.response !== 1) return false
    try {
      this.record = await newKeyRecord(crypto, { resaved: this.record?.resaved ?? [] })
      this.save()
      return true
    } catch {
      await dialog.showMessageBox({ type: 'error', message: 'The keychain is still not available', detail: 'Unlock your keychain (or restart the Mac) and open the browser again.' })
      return false
    }
  }

  private save() {
    if (this.record) writeFileSync(this.file, JSON.stringify(this.record), { mode: 0o600 })
  }

  /**
   * Cookies that were stored before locking was switched on stay readable on
   * disk until they are written again. Do that once per profile, before any of
   * its pages load (so no site can change a cookie in between).
   */
  async protect(partition: string, ses: Session): Promise<void> {
    if (!this.active || !this.record || !ses.isPersistent() || this.record.resaved.includes(partition)) return
    const attempts = this.record.attempts ?? (this.record.attempts = {})
    if ((attempts[partition] ?? 0) >= RESAVE_ATTEMPTS) return
    attempts[partition] = (attempts[partition] ?? 0) + 1
    this.save()
    try {
      const result = await Promise.race([
        resaveCookies(ses),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('took too long')), RESAVE_TIMEOUT_MS)),
      ])
      // A cookie the engine refuses to take back stays as it was (still working,
      // still readable on disk) until its site next writes it. Trying again
      // on later launches would not change that.
      if (result.failed) console.warn(`${result.failed} of ${result.total} cookies in ${partition} could not be written again; they stay as they were.`)
      this.record.resaved.push(partition)
      delete attempts[partition]
      this.save()
    } catch (err) {
      // Not fatal: those cookies get locked whenever their site next writes them.
      console.warn(`Could not re-save the cookies of ${partition}:`, err instanceof Error ? err.message : err)
    }
  }
}

interface RawCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  session: boolean
  size?: number
  [more: string]: unknown
}

/**
 * Write every stored cookie again, exactly as it is. Done through the engine's
 * own inspection interface, because that is the only one that hands a cookie
 * back with ALL its properties (Electron's own leaves out which site a
 * "partitioned" cookie belongs to, and would write a second, different copy).
 */
export async function resaveCookies(ses: Session): Promise<{ total: number; failed: number }> {
  // The interface needs a page to talk through; an empty one that is never shown.
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const wc = view.webContents
  try {
    await wc.loadURL('about:blank')
    wc.debugger.attach('1.3')
    const { cookies } = (await wc.debugger.sendCommand('Network.getAllCookies')) as { cookies: RawCookie[] }
    // Cookies without an end date live in memory only; there is nothing on disk to fix.
    const stored = cookies.filter((c) => !c.session).map(({ size: _size, session: _session, ...cookie }) => cookie)
    let failed = 0
    for (let i = 0; i < stored.length; i += 200) {
      const batch = stored.slice(i, i + 200)
      try {
        await wc.debugger.sendCommand('Network.setCookies', { cookies: batch })
      } catch {
        // One bad cookie refuses the whole batch: write them one at a time.
        for (const cookie of batch) await wc.debugger.sendCommand('Network.setCookies', { cookies: [cookie] }).catch(() => failed++)
      }
    }
    await ses.cookies.flushStore()
    return { total: stored.length, failed }
  } finally {
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      // already gone
    }
    if (!wc.isDestroyed()) wc.close()
  }
}
