import type { SearchEngineId } from './types'

export const SEARCH_ENGINES: Record<SearchEngineId, { name: string; template: string }> = {
  google: { name: 'Google', template: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  kagi: { name: 'Kagi', template: 'https://kagi.com/search?q=%s' },
  brave: { name: 'Brave Search', template: 'https://search.brave.com/search?q=%s' },
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:', 'chrome-extension:', 'view-source:'])

/** host:port, e.g. "localhost:3000" or "192.168.1.10:8080/path" */
const HOST_PORT = /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/
/** example.com, sub.example.co.uk/path — needs a dot and a plausible TLD. */
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}\.?(?::\d+)?(?:[/?#]|$)/i

function searchUrl(query: string, engine: SearchEngineId): string {
  return SEARCH_ENGINES[engine].template.replace('%s', encodeURIComponent(query))
}

/**
 * Turn whatever the user typed into the command bar into a URL to load.
 * Returns null for empty input or a disallowed scheme (e.g. javascript:).
 */
export function resolveInput(raw: string, engine: SearchEngineId): string | null {
  const input = raw.trim()
  if (!input) return null

  const hasSpace = /\s/.test(input)

  if (!hasSpace) {
    if (/^localhost(?::\d+)?(?:[/?#]|$)/i.test(input) || IPV4.test(input)) {
      return `http://${input}`
    }
    if (HOST_PORT.test(input)) return `http://${input}`

    const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(input)?.[1]?.toLowerCase()
    if (scheme) {
      if (!ALLOWED_SCHEMES.has(scheme)) {
        // "mailto:x", "javascript:..." etc. — don't load; search for it instead,
        // except for javascript:, which is never acted on.
        return scheme === 'javascript:' ? null : searchUrl(input, engine)
      }
      try {
        return new URL(input).toString()
      } catch {
        return searchUrl(input, engine)
      }
    }

    if (DOMAIN.test(input)) return `https://${input}`
  }

  return searchUrl(input, engine)
}

/** Short label for the sidebar URL pill: host without "www.". */
export function displayHost(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.host.replace(/^www\./, '')
    return url
  } catch {
    return url
  }
}
