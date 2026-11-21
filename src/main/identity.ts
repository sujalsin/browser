import type { Session } from 'electron'
import { brandHeader, chromiumBrands, firefoxUserAgent, hintPlatform, isGoogleSignIn, sendsClientHints } from '../shared/identity'

// What this browser tells websites about itself (see shared/identity.ts for
// the reasoning). Electron sets the User-Agent string; two things are put
// right here, in the request headers of every profile:
//
//   - Page and frame loads go out of Electron with no client-hint headers at
//     all, though any Chromium browser sends Sec-CH-UA, Sec-CH-UA-Mobile and
//     Sec-CH-UA-Platform with them. A "Chrome 156" that leaves them out stands
//     out to bot checks. They are added, with the values Chromium itself puts
//     on every other request.
//   - Requests to Google's sign-in host carry a Firefox User-Agent.

const SEC_CH_UA = brandHeader(chromiumBrands(Number(process.versions.chrome.split('.')[0])))
const SEC_CH_UA_PLATFORM = `"${hintPlatform(process.platform)}"`
const FIREFOX_USER_AGENT = firefoxUserAgent(process.platform, Date.now())

export function attachIdentityHeaders(ses: Session): void {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    let changed = false
    if (headers['sec-ch-ua'] === undefined) {
      const isDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'
      if (isDocument && sendsClientHints(details.url)) {
        headers['sec-ch-ua'] = SEC_CH_UA
        headers['sec-ch-ua-mobile'] = '?0'
        headers['sec-ch-ua-platform'] = SEC_CH_UA_PLATFORM
        changed = true
      }
    }
    if (isGoogleSignIn(details.url)) {
      headers['User-Agent'] = FIREFOX_USER_AGENT
      changed = true
    }
    callback(changed ? { requestHeaders: headers } : {})
  })
}
