// How this browser identifies itself to websites (no Electron here: unit-tested).
//
// It is a Chromium browser and says so, the way a plain Chromium build does:
//   - a Chrome-style User-Agent string, and
//   - "client hints" (Sec-CH-UA request headers, navigator.userAgentData) whose
//     brand list says "Chromium".
// It does not claim the Google Chrome brand. On Google's sign-in pages it goes
// one step further and names itself (see the end of this file).

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
// Google's sign-in refuses a browser whose User-Agent is exactly Chrome's when
// the browser behind it is not Chrome ("This browser or app may not be secure").
// It accepts one that says what it is: the same string with the app's own name
// in it, the way Edge and Opera add theirs. Everywhere else the plain string
// stays, because some sites turn away names they don't know; the sign-in hosts
// get the honest one.
//
// Measured against the real sign-in page (Chromium 156, November 2026), with a
// made-up address: plain Chrome string, refused 4 of 4; a Firefox string on
// these hosts, refused 1 of 4; the app's own string, accepted every time.

/** Is this request for one of Google's sign-in hosts? */
export function isGoogleSignIn(url: string): boolean {
  return url.startsWith('https://accounts.google.com/') || url.startsWith('https://accounts.youtube.com/')
}
