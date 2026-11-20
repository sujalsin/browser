import type { Boost } from './types'

/**
 * Turn what someone typed ("https://www.YouTube.com/watch?v=1", "youtube.com")
 * into the domain a Boost applies to ("youtube.com"), or null if it isn't one.
 */
export function normalizeDomain(input: string): string | null {
  let host = input.trim().toLowerCase()
  if (!host) return null
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(host) ? host : `https://${host}`).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) || host.length > 253) return null
  return host
}

/** Enabled Boosts for a page: the domain itself or any subdomain of it. */
export function boostsFor(boosts: Boost[], url: string): Boost[] {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return []
    host = u.hostname.toLowerCase()
  } catch {
    return []
  }
  return boosts.filter((b) => b.enabled && (host === b.domain || host.endsWith(`.${b.domain}`)))
}

/** The CSS rule Zap adds to hide an element. */
export function hideRule(selector: string): string {
  return `${selector} { display: none !important; }`
}

/**
 * Page script for Zap: a reasonably stable CSS selector for the element at
 * (x, y), preferring ids and meaningful classes over long nth-child chains.
 * Returns null for the page root.
 */
export function selectorScript(x: number, y: number): string {
  return `(() => {
  const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})
  if (!el || el === document.body || el === document.documentElement) return null
  const generated = (s) => /\\d{4,}|[a-f0-9]{8,}/i.test(s)
  const parts = []
  let e = el
  while (e && e.nodeType === 1 && e !== document.body && parts.length < 5) {
    if (e.id && !generated(e.id)) { parts.unshift('#' + CSS.escape(e.id)); break }
    let p = e.tagName.toLowerCase()
    const classes = [...e.classList].filter((c) => !generated(c) && !/^(active|hover|focus|selected|open|is-|has-)/.test(c)).slice(0, 2)
    if (classes.length) p += '.' + classes.map((c) => CSS.escape(c)).join('.')
    const parent = e.parentElement
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === e.tagName)
      if (same.length > 1 && !classes.length) p += ':nth-of-type(' + (same.indexOf(e) + 1) + ')'
    }
    parts.unshift(p)
    e = e.parentElement
  }
  return parts.join(' > ') || null
})()`
}

/** A Boost's JavaScript wrapped so an error in it can't break the page's own scripts. */
export function wrapBoostScript(js: string): string {
  return `(() => { try {\n${js}\n} catch (err) { console.error('Boost error:', err) } })()`
}
