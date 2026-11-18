// URL-level privacy protections (no network, no Electron): easy to unit test.

/**
 * Query parameters used only for cross-site tracking. Removed from top-level
 * navigations. Follows Brave's list, which is chosen not to break sites; it
 * deliberately keeps utm_* (first-party analytics, sometimes required).
 */
export const TRACKING_PARAMS = new Set([
  '__hsfp',
  '__hssc',
  '__hstc',
  '__s',
  '_bhlid',
  '_branch_match_id',
  '_branch_referrer',
  '_gl',
  '_hsenc',
  '_kx',
  '_openstat',
  'at_recipient_id',
  'at_recipient_list',
  'bbeml',
  'bsft_clkid',
  'bsft_uid',
  'dclid',
  'et_rid',
  'fb_action_ids',
  'fb_comment_id',
  'fbclid',
  'gbraid',
  'gclid',
  'guce_referrer',
  'guce_referrer_sig',
  'hsCtaTracking',
  'igshid',
  'irclickid',
  'mc_eid',
  'ml_subscriber',
  'ml_subscriber_hash',
  'msclkid',
  'mtm_cid',
  'oft_c',
  'oft_ck',
  'oft_d',
  'oft_id',
  'oft_ids',
  'oft_k',
  'oft_lk',
  'oft_sk',
  'oly_anon_id',
  'oly_enc_id',
  'pk_cid',
  'rb_clickid',
  's_cid',
  'sc_customer',
  'sc_eh',
  'sc_uid',
  'srsltid',
  'ss_email_id',
  'ttclid',
  'twclid',
  'unicorn_click_id',
  'vero_conv',
  'vero_id',
  'vgo_ee',
  'wbraid',
  'wickedid',
  'yclid',
  'ymclid',
  'ysclid',
])

/** Returns the URL without tracking parameters, or null if there were none. */
export function stripTrackingParams(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.search) return null
  const keep = new URLSearchParams()
  let removed = false
  for (const [key, value] of u.searchParams) {
    if (TRACKING_PARAMS.has(key)) removed = true
    else keep.append(key, value)
  }
  if (!removed) return null
  const query = keep.toString()
  u.search = query ? `?${query}` : ''
  return u.toString()
}

const LOCAL_SUFFIXES = ['.local', '.localhost', '.lan', '.home', '.internal', '.test', '.home.arpa', '.onion', '.intranet', '.corp']

/**
 * Can this http:// URL reasonably be tried over https? Skips localhost, IP
 * addresses, single-label intranet names ("router") and local-only TLDs.
 */
export function isUpgradeable(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:') return false
  const host = u.hostname.toLowerCase()
  if (!host.includes('.')) return false // localhost, intranet names
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return false // IPv4 / IPv6
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return false
  if (u.port && u.port !== '80') return false // custom ports rarely serve TLS on the same port
  return true
}

/** http://host/path → https://host/path (drops an explicit :80). */
export function toHttps(url: string): string {
  const u = new URL(url)
  u.protocol = 'https:'
  if (u.port === '80') u.port = ''
  return u.toString()
}

/** https://host/path → http://host/path */
export function toHttp(url: string): string {
  const u = new URL(url)
  u.protocol = 'http:'
  return u.toString()
}

/**
 * Network errors after which an upgraded https:// load should fall back to
 * http:// (TLS / certificate / connection problems, not DNS failures).
 */
export function isHttpsFailure(errorCode: number): boolean {
  if (errorCode === -105) return false // ERR_NAME_NOT_RESOLVED: http would fail too
  return (
    (errorCode <= -100 && errorCode >= -299) || // connection, SSL and certificate errors
    errorCode === -7 || // ERR_TIMED_OUT
    errorCode === -118 // ERR_CONNECTION_TIMED_OUT
  )
}
