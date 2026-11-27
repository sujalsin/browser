/**
 * Sign-ins (cookies) and saved passwords are locked with one key, which macOS
 * keeps in the keychain under "Browser Safe Storage". If that key cannot be
 * had at launch (the keychain question was answered "Deny", the keychain is
 * locked) or is a different key than before (keychain reset, profile copied
 * from another Mac), carrying on would let the engine throw away everything
 * the old key locked. So before any profile is opened, a small known text
 * locked with the key is unlocked again; only if that works does the browser
 * continue.
 *
 * This file is the logic alone (no Electron), so it can be tested.
 */

export const KEY_FILE = 'key-check.json'
const CHECK_TEXT = 'browser-key-check-v1'

export interface KeyCrypto {
  encrypt(text: string): Promise<Buffer>
  decrypt(data: Buffer): Promise<string>
}

export interface KeyRecord {
  v: 1
  /** CHECK_TEXT locked with the key, base64. */
  check: string
  /** Profiles whose existing cookies have been saved again, locked. */
  resaved: string[]
  /** Attempts at that which did not finish, per profile. */
  attempts?: Record<string, number>
}

export function parseKeyRecord(text: string | null | undefined): KeyRecord | null {
  if (!text) return null
  try {
    const r = JSON.parse(text) as Partial<KeyRecord>
    if (r?.v !== 1 || typeof r.check !== 'string' || !r.check) return null
    const attempts: Record<string, number> = {}
    for (const [k, n] of Object.entries(r.attempts ?? {})) if (typeof n === 'number') attempts[k] = n
    return { v: 1, check: r.check, resaved: Array.isArray(r.resaved) ? r.resaved.filter((p): p is string => typeof p === 'string') : [], attempts }
  } catch {
    return null
  }
}

export type KeyVerdict =
  /** No record yet: this profile has never been locked. */
  | 'first'
  | 'ok'
  /** The key could not be had at all (denied, locked, no keychain). */
  | 'unavailable'
  /** A key was handed over, but not the one that locked this profile. */
  | 'different'

export async function verifyKey(record: KeyRecord | null, crypto: KeyCrypto): Promise<KeyVerdict> {
  if (!record) return 'first'
  let text: string
  try {
    text = await crypto.decrypt(Buffer.from(record.check, 'base64'))
  } catch {
    // Unlocking failed. Can the key lock something new? Then it is simply another key.
    try {
      await crypto.encrypt(CHECK_TEXT)
      return 'different'
    } catch {
      return 'unavailable'
    }
  }
  return text === CHECK_TEXT ? 'ok' : 'different'
}

/** A fresh record for the key as it is now. Throws if the key cannot be had. */
export async function newKeyRecord(crypto: KeyCrypto, keep?: Pick<KeyRecord, 'resaved' | 'attempts'>): Promise<KeyRecord> {
  const locked = await crypto.encrypt(CHECK_TEXT)
  // Make sure it really round-trips before anything relies on it.
  if ((await crypto.decrypt(locked)) !== CHECK_TEXT) throw new Error('the key does not unlock what it locked')
  return { v: 1, check: locked.toString('base64'), resaved: keep?.resaved ?? [], attempts: keep?.attempts ?? {} }
}
