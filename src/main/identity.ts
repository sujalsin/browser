import type { Session, WebContents } from 'electron'
import { brandHeader, chromeBrands, fullVersionBrands, hintPlatform, hintPlatformVersion, sendsClientHints } from '../shared/identity'

// This browser tells websites it is Chrome (see shared/identity.ts for why).
// Electron gets that half right: it can set the User-Agent string, but
//   - page loads go out with no client-hint headers at all (Chrome always sends
//     Sec-CH-UA, Sec-CH-UA-Mobile and Sec-CH-UA-Platform), and
//   - other requests and navigator.userAgentData list only "Chromium".
// A "Chrome" that disagrees with itself like that is what bot checks (sign-in
// pages, reCAPTCHA, streaming sites) look for. Electron has no setting for it,
// so the two halves below put it right.

const CHROME_VERSION = process.versions.chrome
const BRANDS = chromeBrands(Number(CHROME_VERSION.split('.')[0]))
const FULL_BRANDS = fullVersionBrands(BRANDS, CHROME_VERSION)
const PLATFORM = hintPlatform(process.platform)

const SEC_CH_UA = brandHeader(BRANDS)

/**
 * Request headers, for everything a profile loads. Works from the very first
 * request of a new tab, and for service workers, which the override below
 * reaches late or not at all.
 *
 * Not covered: the detailed hints (full version, CPU architecture, …) that
 * Chrome adds for sites that ask with an Accept-CH header. Electron never
 * sends those; scripts can still read them (see below).
 */
export function attachIdentityHeaders(ses: Session): void {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    let changed = false
    const brands = headers['sec-ch-ua']
    if (brands === undefined) {
      // Chromium left the hints off: that happens for page and frame loads.
      const isDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
      if (isDocument && sendsClientHints(details.url)) {
        headers['sec-ch-ua'] = SEC_CH_UA
        headers['sec-ch-ua-mobile'] = '?0'
        headers['sec-ch-ua-platform'] = `"${PLATFORM}"`
        changed = true
      }
    } else if (brands !== SEC_CH_UA) {
      headers['sec-ch-ua'] = SEC_CH_UA
      changed = true
    }
    callback(changed ? { requestHeaders: headers } : {})
  })
}

/**
 * Scripts (navigator.userAgentData), for one page. Set through Chromium's own
 * DevTools protocol, which overrides it natively for the page, its embedded
 * frames and its workers. Call once per WebContents. If it can't be applied the
 * page simply reports "Chromium", as before.
 */
export function applyChromeIdentity(wc: WebContents): void {
  const override = {
    userAgent: wc.session.getUserAgent(),
    userAgentMetadata: {
      brands: BRANDS,
      fullVersionList: FULL_BRANDS,
      fullVersion: CHROME_VERSION,
      platform: PLATFORM,
      platformVersion: process.platform === 'darwin' ? hintPlatformVersion(process.getSystemVersion()) : '',
      architecture: process.arch === 'arm64' ? 'arm' : 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  }
  const dbg = wc.debugger

  const apply = () => {
    if (wc.isDestroyed() || dbg.isAttached()) return
    try {
      dbg.attach('1.3')
    } catch {
      return // something else (e.g. an extension's debugger) owns this page
    }
    dbg.sendCommand('Emulation.setUserAgentOverride', override).catch(() => {})
    // Embedded frames from other sites (reCAPTCHA is one) and workers are separate
    // targets: attach to them as they appear, without pausing them.
    dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {})
  }

  dbg.on('message', (_event, method, params: { sessionId?: string }) => {
    if (method === 'Target.attachedToTarget' && params.sessionId) {
      dbg.sendCommand('Emulation.setUserAgentOverride', override, params.sessionId).catch(() => {})
    }
  })
  // A page that has never loaded anything has no renderer process yet, and an
  // override sent then only arrives after the first page is already running. So
  // apply as the first load starts (the process exists by then, and the override
  // lands well before the site answers). This also restores the override if the
  // protocol connection was ever dropped.
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) apply()
  })
  // A page handed over already running (opened by a site with window.open).
  if (wc.getOSProcessId() !== 0) apply()
}
