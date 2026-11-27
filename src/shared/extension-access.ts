/**
 * What an extension is allowed to do, in plain words, for the question shown
 * before one is added (Chrome shows the same kind of summary).
 */

interface ManifestLike {
  permissions?: unknown
  host_permissions?: unknown
  optional_permissions?: unknown
  content_scripts?: unknown
  origins?: unknown
}

const EVERY_SITE = /^(<all_urls>|(\*|https?|wss?):\/\/\*(:\*)?\/.*)$/i

const POWERS: Record<string, string> = {
  tabs: 'See the addresses and titles of your open tabs',
  history: 'Read and change your browsing history',
  bookmarks: 'Read and change your bookmarks',
  cookies: 'Read and change cookies, which includes your signed-in sessions',
  downloads: 'Manage your downloads',
  clipboardRead: 'Read what you copy',
  webRequest: 'Watch the network requests your pages make',
  webRequestBlocking: 'Watch and change the network requests your pages make',
  declarativeNetRequest: 'Block or redirect network requests',
  nativeMessaging: 'Talk to other apps on this computer',
  management: 'Manage your other extensions',
  proxy: 'Change how this browser connects to the internet',
  debugger: 'Take full control of pages (debugger access)',
  privacy: 'Change privacy settings',
  geolocation: 'Know your location',
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

function hostOf(pattern: string): string | null {
  const m = /^[^:]+:\/\/([^/]+)\//.exec(pattern)
  return m ? m[1].replace(/^\*\./, '') : null
}

/** One line per thing the extension may do; the broadest first. */
export function describeExtensionAccess(manifest: ManifestLike | null | undefined): string[] {
  if (!manifest || typeof manifest !== 'object') return []
  const named = [...strings(manifest.permissions), ...strings(manifest.origins)]
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts.flatMap((c) => strings((c as { matches?: unknown })?.matches)) : []
  // Manifest V2 lists site patterns among the permissions.
  const patterns = [...strings(manifest.host_permissions), ...scripts, ...named.filter((p) => p.includes('://') || p === '<all_urls>')]

  const lines: string[] = []
  if (patterns.some((p) => EVERY_SITE.test(p))) {
    lines.push('Read and change everything on every website you visit, including what you type')
  } else {
    const hosts = [...new Set(patterns.map(hostOf).filter((h): h is string => !!h))]
    if (hosts.length) lines.push(`Read and change what is on: ${hosts.slice(0, 6).join(', ')}${hosts.length > 6 ? ` and ${hosts.length - 6} more` : ''}`)
  }
  const seen = new Set<string>()
  for (const name of named) {
    // "webRequestBlocking" says everything "webRequest" does.
    if (name === 'webRequest' && named.includes('webRequestBlocking')) continue
    const line = POWERS[name]
    if (line && !seen.has(line)) (seen.add(line), lines.push(line))
  }
  return lines
}
