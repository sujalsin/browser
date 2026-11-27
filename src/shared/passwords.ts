// Saved passwords: the parts with no Electron in them (unit-tested).
//
// A password is saved for a site's origin (https://accounts.example.com) and
// offered only on that same origin. Nothing here ever holds a password longer
// than the call that passes it through.

export interface ImportedLogin {
  origin: string
  username: string
  password: string
}

/**
 * Where a password belongs: the page's origin. Only web pages over https
 * qualify, plus http on this computer (for local development).
 */
export function loginOrigin(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  return u.origin
}

/** One CSV document into rows of fields: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/**
 * Logins from a password file exported by Arc, Chrome, Edge or Brave
 * (columns: name, url, username, password, note; found by their header, in any
 * order). Rows without a usable web address or without a password are skipped.
 */
export function parsePasswordCsv(text: string): { logins: ImportedLogin[]; skipped: number } {
  const rows = parseCsv(text)
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? []
  const urlAt = header.findIndex((h) => h === 'url' || h === 'login_uri' || h === 'website')
  const userAt = header.findIndex((h) => h === 'username' || h === 'login_username' || h === 'login')
  const passAt = header.findIndex((h) => h === 'password' || h === 'login_password')
  if (urlAt < 0 || passAt < 0) return { logins: [], skipped: rows.length }
  const logins: ImportedLogin[] = []
  let skipped = 0
  for (const row of rows) {
    const origin = loginOrigin((row[urlAt] ?? '').trim())
    const password = row[passAt] ?? ''
    if (!origin || !password) {
      skipped++
      continue
    }
    logins.push({ origin, username: userAt >= 0 ? (row[userAt] ?? '').trim() : '', password })
  }
  return { logins, skipped }
}

/**
 * The same kind of file, written: a backup of the saved passwords that this
 * browser, Chrome, Arc and Bitwarden can all read back. Passwords are written
 * exactly as they are (quoted where the format needs it).
 */
export function toPasswordCsv(logins: { origin: string; username: string; password: string }[]): string {
  const cell = (value: string) => (/[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value)
  const host = (origin: string) => origin.replace(/^https?:\/\//, '')
  const lines = logins.map((l) => [host(l.origin), `${l.origin}/`, l.username, l.password].map(cell).join(','))
  return ['name,url,username,password', ...lines].join('\n') + '\n'
}

/**
 * Which of a form's filled-in password fields holds the password to remember.
 * One field: that one. Sign-up and change-password forms repeat the new
 * password, so when the last two match it is the new one.
 */
export function passwordToSave(values: string[]): string {
  const filled = values.filter((v) => v !== '')
  if (filled.length >= 2 && filled[filled.length - 1] === filled[filled.length - 2]) return filled[filled.length - 1]
  return filled[0] ?? ''
}

/** IPC channels between a page's start-up script and the main process. */
export const LOGINS = {
  /** A login field got the focus: offer the saved accounts. */
  focus: 'logins:focus',
  /** Put these into the form (main → page). */
  fill: 'logins:fill',
  /** A form with a password was sent. */
  submit: 'logins:submit',
  /** The first step of a two-step sign-in: just the user name. */
  username: 'logins:username',
} as const
