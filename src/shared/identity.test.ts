import { describe, expect, it } from 'vitest'
import { brandHeader, chromeUserAgent, chromiumBrands, isGoogleSignIn, sendsClientHints } from './identity'

describe('brand list', () => {
  it('is what this Chromium reports on its own (seen in its requests)', () => {
    expect(brandHeader(chromiumBrands(156))).toBe('"Not:A-Brand";v="8", "Chromium";v="156"')
  })

  it('never claims to be Google Chrome', () => {
    for (let major = 100; major < 220; major++) {
      const names = chromiumBrands(major).map((b) => b.brand)
      expect(names).toHaveLength(2)
      expect(names).toContain('Chromium')
      expect(names.filter((n) => n.startsWith('Not'))).toHaveLength(1)
    }
  })

  it('orders by version, as Chromium does', () => {
    expect(chromiumBrands(157)[0].brand).toBe('Chromium')
    expect(chromiumBrands(158)[1].brand).toBe('Chromium')
  })
})

describe('user agent', () => {
  it('turns Electron’s into a plain Chrome-style one', () => {
    expect(
      chromeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Browser/0.1.0 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36',
      ),
    ).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36')
  })

  it('leaves an already plain one alone', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe(ua)
  })
})

describe('client hints', () => {
  it('go only to secure pages', () => {
    expect(sendsClientHints('https://www.netflix.com/browse')).toBe(true)
    expect(sendsClientHints('http://localhost:3000/')).toBe(true)
    expect(sendsClientHints('http://127.0.0.1/')).toBe(true)
    expect(sendsClientHints('http://example.com/')).toBe(false)
    expect(sendsClientHints('http://localhost.evil.com/')).toBe(false)
    expect(sendsClientHints('wss://example.com/')).toBe(false)
  })
})

describe('Google sign-in', () => {
  it('means the sign-in hosts only', () => {
    expect(isGoogleSignIn('https://accounts.google.com/v3/signin/identifier?continue=x')).toBe(true)
    expect(isGoogleSignIn('https://accounts.google.com/')).toBe(true)
    expect(isGoogleSignIn('https://accounts.youtube.com/accounts/SetSID')).toBe(true)
    expect(isGoogleSignIn('https://www.google.com/search?q=accounts.google.com')).toBe(false)
    expect(isGoogleSignIn('https://mail.google.com/')).toBe(false)
    expect(isGoogleSignIn('https://www.youtube.com/')).toBe(false)
    expect(isGoogleSignIn('https://accounts.google.com.evil.example/')).toBe(false)
    expect(isGoogleSignIn('http://accounts.google.com/')).toBe(false)
  })
})
