// How this browser identifies itself to websites (no Electron here: unit-tested).
//
// It is a Chromium browser and says so, the way a plain Chromium build does:
//   - a Chrome-style User-Agent string, and
//   - "client hints" (Sec-CH-UA request headers, navigator.userAgentData) whose
//     brand list says "Chromium".
// It does not claim to be Google Chrome itself. Google can tell that it isn't,
// and refuses sign-in to browsers that pretend ("This browser or app may not be
// secure").

export interface Brand {
  brand: string
  version: string
}

// Chromium adds a deliberately odd brand ("grease", e.g. "Not:A-Brand") and
// orders the list by version, so that sites can't depend on its exact shape.
// This is its algorithm (GenerateBrandVersionList in
// components/embedder_support/user_agent_utils.cc) for a build with no product
// brand of its own.
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
const GREASE_VERSIONS = ['8', '99', '24']

/** The brand list a Chromium build of this major version reports, in its order. */
export function chromiumBrands(major: number): Brand[] {
  const grease: Brand = {
    brand: `Not${GREASE_CHARS[major % GREASE_CHARS.length]}A${GREASE_CHARS[(major + 1) % GREASE_CHARS.length]}Brand`,
    version: GREASE_VERSIONS[major % GREASE_VERSIONS.length],
  }
  const list: Brand[] = []
  list[major % 2] = grease
  list[(major + 1) % 2] = { brand: 'Chromium', version: String(major) }
  return list
}

/** A brand list as a Sec-CH-UA header value: `"Not:A-Brand";v="8", "Chromium";v="156"`. */
export function brandHeader(brands: Brand[]): string {
  return brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
}

/**
 * A plain Chrome-style User-Agent from Electron's: drops the Electron and app
 * tokens and, like Chrome and Chromium, reports only the major version
 * ("Chrome/156.0.0.0").
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

/** Chromium sends client hints only to secure pages (https, or this computer). */
export function sendsClientHints(url: string): boolean {
  return url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)
}

// ───────────────────────────── Google sign-in ─────────────────────────────
//
// Google's sign-in pages run extra checks on anything that presents itself as a
// Chrome-family browser, and reject browsers built on an embedded engine such
// as Electron. They don't run them for Firefox. So requests to the sign-in
// host, and only those, go out with a Firefox User-Agent. This is the approach
// the Min browser (also Electron) has used for years; see its UASwitcher.js.

/** Is this request for Google's sign-in host? */
export function isGoogleSignIn(url: string): boolean {
  return url.startsWith('https://accounts.google.com/')
}

/**
 * A current Firefox User-Agent. Firefox releases about every four weeks; this
 * estimates the current version from the date, counting from version 91
 * (10 August 2021), so it stays plausible without ever needing an update.
 */
export function firefoxUserAgent(platform: string, now: number): string {
  const FOUR_WEEKS_ISH = 4.1 * 7 * 24 * 60 * 60 * 1000
  const version = 91 + Math.floor((now - Date.UTC(2021, 7, 10)) / FOUR_WEEKS_ISH)
  const system =
    platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${system}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`
}
