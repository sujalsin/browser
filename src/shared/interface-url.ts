/**
 * The browser's own interface (sidebar, command bar, Library, find bar, the
 * Little Arc toolbar) is a document with controls no website may have: it can
 * read every open tab, the history and the saved passwords list. These two
 * checks keep that document where it is, and keep everything else away from
 * its controls.
 */

function documentOf(url: string): string | null {
  try {
    const u = new URL(url)
    // "index.html#overlay" and "index.html#find" are the same document as "index.html".
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return null
  }
}

/** Is `url` the interface's own document (whatever comes after "#")? */
export function isInterfaceUrl(url: string | undefined | null, rendererUrl: string): boolean {
  if (!url) return false
  const own = documentOf(rendererUrl)
  return own !== null && documentOf(url) === own
}

/** Links handed over by other apps: only ordinary web addresses are opened. */
export function isOpenableLink(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\/[^\s/]/i.test(url) && url.length < 8192
}
