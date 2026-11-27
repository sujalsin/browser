/**
 * Links that open another app instead of a page: zoommtg:, slack:, mailto:,
 * msteams:, spotify: … A page may ask for one, but the browser asks you first
 * and names the app, because such a link hands whatever the page wrote to a
 * program outside the browser's sandbox.
 */

/**
 * Kinds of link a page may never hand to the system, whatever you answer:
 * the browser's own, and ones that make the Mac connect to file servers or
 * other computers, or open local help pages and scripts. None is needed by a
 * website, and each has been used to attack people.
 */
const NEVER = new Set([
  // handled inside the browser, or internal to it
  'http', 'https', 'ws', 'wss', 'ftp', 'file', 'filesystem', 'blob', 'data', 'about', 'javascript', 'view-source', 'chrome', 'chrome-extension', 'devtools', 'crx',
  // mount a network drive or open a remote session
  'smb', 'cifs', 'afp', 'nfs', 'webdav', 'dav', 'davs', 'vnc', 'rdp', 'ssh', 'sftp', 'telnet', 'rlogin',
  // local help viewers, scripts and installers
  'help', 'x-help-action', 'x-man-page', 'applescript', 'osascript', 'shell', 'terminal', 'x-apple-helpbasic', 'hcp', 'ms-help', 'vbscript', 'itms-services', 'disk', 'disks', 'nntp',
])

/** The kind of app link ("zoommtg", "mailto"), or null if pages may not open this at all. */
export function appLinkScheme(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 8192) return null
  const scheme = /^([a-z][a-z0-9+.-]{0,63}):/i.exec(url.trim())?.[1]?.toLowerCase()
  return scheme && !NEVER.has(scheme) ? scheme : null
}

/** Under this name the "always open from this site" answer is remembered, one per kind of link. */
export const APP_LINK_PERMISSION = 'openExternal'
export const appLinkPermission = (scheme: string): string => `${APP_LINK_PERMISSION}:${scheme}`

/** The link as shown in the question: one line, no hidden characters, not too long. */
export function showAppLink(url: string, max = 90): string {
  // Control characters and the invisible ones that reorder or hide text.
  // eslint-disable-next-line no-control-regex
  const clean = url.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** Label for Settings → Site Permissions. */
export function appLinkLabel(permission: string): string | null {
  return permission.startsWith(`${APP_LINK_PERMISSION}:`) ? `Open app links (${permission.slice(APP_LINK_PERMISSION.length + 1)})` : null
}
