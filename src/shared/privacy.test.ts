import { describe, expect, it } from 'vitest'
import { isHttpsFailure, isUpgradeable, stripTrackingParams, toHttp, toHttps } from './privacy'

describe('stripTrackingParams', () => {
  it('removes tracking parameters and keeps the rest', () => {
    expect(stripTrackingParams('https://shop.com/item?id=5&fbclid=abc&color=red')).toBe('https://shop.com/item?id=5&color=red')
  })
  it('removes the query string entirely when nothing is left', () => {
    expect(stripTrackingParams('https://news.com/story?gclid=1&msclkid=2')).toBe('https://news.com/story')
  })
  it('keeps the fragment', () => {
    expect(stripTrackingParams('https://a.com/p?fbclid=1#section')).toBe('https://a.com/p#section')
  })
  it('returns null when there is nothing to strip', () => {
    expect(stripTrackingParams('https://a.com/p?q=cats')).toBeNull()
    expect(stripTrackingParams('https://a.com/p')).toBeNull()
  })
  it('keeps utm_* (first-party analytics)', () => {
    expect(stripTrackingParams('https://a.com/?utm_source=x')).toBeNull()
  })
  it('ignores non-web URLs', () => {
    expect(stripTrackingParams('chrome-extension://abc/popup.html?fbclid=1')).toBeNull()
    expect(stripTrackingParams('not a url')).toBeNull()
  })
})

describe('isUpgradeable', () => {
  it('upgrades ordinary http sites', () => {
    expect(isUpgradeable('http://example.com/page')).toBe(true)
    expect(isUpgradeable('http://example.com:80/')).toBe(true)
  })
  it('leaves https and non-web URLs alone', () => {
    expect(isUpgradeable('https://example.com')).toBe(false)
    expect(isUpgradeable('file:///tmp/a.html')).toBe(false)
  })
  it('skips local and intranet hosts', () => {
    expect(isUpgradeable('http://localhost:3000')).toBe(false)
    expect(isUpgradeable('http://router/')).toBe(false)
    expect(isUpgradeable('http://192.168.1.1/')).toBe(false)
    expect(isUpgradeable('http://[::1]/')).toBe(false)
    expect(isUpgradeable('http://printer.local/')).toBe(false)
    expect(isUpgradeable('http://app.test/')).toBe(false)
  })
  it('skips custom ports', () => {
    expect(isUpgradeable('http://example.com:8080/')).toBe(false)
  })
})

describe('scheme helpers', () => {
  it('converts between http and https', () => {
    expect(toHttps('http://example.com:80/a?b=1')).toBe('https://example.com/a?b=1')
    expect(toHttp('https://example.com/a')).toBe('http://example.com/a')
  })
})

describe('isHttpsFailure', () => {
  it('falls back on TLS and connection errors', () => {
    expect(isHttpsFailure(-202)).toBe(true) // ERR_CERT_AUTHORITY_INVALID
    expect(isHttpsFailure(-102)).toBe(true) // ERR_CONNECTION_REFUSED
    expect(isHttpsFailure(-107)).toBe(true) // ERR_SSL_PROTOCOL_ERROR
  })
  it('does not fall back when the name does not resolve', () => {
    expect(isHttpsFailure(-105)).toBe(false)
    expect(isHttpsFailure(-3)).toBe(false)
  })
})
