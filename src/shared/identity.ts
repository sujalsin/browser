// How this browser identifies itself to websites (no Electron here: unit-tested).
//
// It presents itself as Chrome, because sites such as Google sign-in and
// Netflix refuse or misbehave for browsers they don't recognise. Chrome
// identifies itself in two places that must agree:
//   1. the User-Agent string, and
//   2. "client hints": Sec-CH-UA request headers and navigator.userAgentData,
//      which list the browser's "brands".

export interface Brand {
  brand: string
  version: string
}

// Chrome adds a deliberately odd brand ("grease", e.g. "Not:A-Brand") and
// shuffles the list, both derived from the major version, so that sites can't
// depend on the list's exact shape. This is Chromium's algorithm
// (GenerateBrandVersionList in components/embedder_support/user_agent_utils.cc).
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
const GREASE_VERSIONS = ['8', '99', '24']
const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

/** The brand list Google Chrome of this major version reports, in Chrome's order. */
export function chromeBrands(major: number): Brand[] {
  const version = String(major)
  const grease: Brand = {
    brand: `Not${GREASE_CHARS[major % GREASE_CHARS.length]}A${GREASE_CHARS[(major + 1) % GREASE_CHARS.length]}Brand`,
    version: GREASE_VERSIONS[major % GREASE_VERSIONS.length],
  }
  const order = ORDERS[major % ORDERS.length]
  const list: Brand[] = []
  list[order[0]] = grease
  list[order[1]] = { brand: 'Chromium', version }
  list[order[2]] = { brand: 'Google Chrome', version }
  return list
}

/** The same list with full version numbers ("156.0.8078.75"; the grease brand gets "8.0.0.0"). */
export function fullVersionBrands(brands: Brand[], fullVersion: string): Brand[] {
  return brands.map((b) => ({ brand: b.brand, version: b.brand.startsWith('Not') ? `${b.version}.0.0.0` : fullVersion }))
}

/** A brand list as a Sec-CH-UA header value: `"Chromium";v="156", "Google Chrome";v="156", …`. */
export function brandHeader(brands: Brand[]): string {
  return brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
}

/**
 * A plain Chrome User-Agent from Electron's: drops the Electron and app tokens
 * and, like Chrome, reports only the major version ("Chrome/156.0.0.0").
 */
export function chromeUserAgent(electronUserAgent: string): string {
  return electronUserAgent
    .replace(/\s(\S+)\/(\S+)/g, (token, name: string) => (['AppleWebKit', 'Chrome', 'Safari'].includes(name) ? token : ''))
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0')
}

/** Client-hint platform name for a Node `process.platform`. */
export function hintPlatform(platform: string): string {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'
}

/** OS version as client hints give it: always three parts ("26.1" → "26.1.0"). */
export function hintPlatformVersion(version: string): string {
  const parts = version.split('.').filter((p) => /^\d+$/.test(p))
  if (!parts.length) return ''
  while (parts.length < 3) parts.push('0')
  return parts.slice(0, 3).join('.')
}

/** Chrome sends client hints only to secure pages (https, or this computer). */
export function sendsClientHints(url: string): boolean {
  return url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)
}
