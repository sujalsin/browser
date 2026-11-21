import { describe, expect, it } from 'vitest'
import { brandHeader, chromeBrands, chromeUserAgent, fullVersionBrands, hintPlatformVersion, sendsClientHints } from './identity'

describe('brand list', () => {
  // Sec-CH-UA values sent by real Google Chrome releases.
  it('matches what real Chrome sends', () => {
    expect(brandHeader(chromeBrands(120))).toBe('"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"')
    expect(brandHeader(chromeBrands(131))).toBe('"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"')
  })

  it('extends the list this Chromium reports on its own (156: "Not:A-Brand";v="8", "Chromium";v="156")', () => {
    expect(brandHeader(chromeBrands(156))).toBe('"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"')
  })

  it('always has exactly the three brands', () => {
    for (let major = 100; major < 220; major++) {
      const names = chromeBrands(major).map((b) => b.brand)
      expect(names).toHaveLength(3)
      expect(names).toContain('Chromium')
      expect(names).toContain('Google Chrome')
      expect(names.filter((n) => n.startsWith('Not'))).toHaveLength(1)
    }
  })

  it('gives full versions', () => {
    expect(brandHeader(fullVersionBrands(chromeBrands(131), '131.0.6778.86'))).toBe(
      '"Google Chrome";v="131.0.6778.86", "Chromium";v="131.0.6778.86", "Not_A Brand";v="24.0.0.0"',
    )
  })
})

describe('user agent', () => {
  it('turns Electron’s into plain Chrome’s', () => {
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
  it('pads the OS version to three parts', () => {
    expect(hintPlatformVersion('26.1')).toBe('26.1.0')
    expect(hintPlatformVersion('15.6.1')).toBe('15.6.1')
    expect(hintPlatformVersion('26')).toBe('26.0.0')
    expect(hintPlatformVersion('')).toBe('')
  })

  it('go only to secure pages', () => {
    expect(sendsClientHints('https://www.netflix.com/browse')).toBe(true)
    expect(sendsClientHints('http://localhost:3000/')).toBe(true)
    expect(sendsClientHints('http://127.0.0.1/')).toBe(true)
    expect(sendsClientHints('http://example.com/')).toBe(false)
    expect(sendsClientHints('http://localhost.evil.com/')).toBe(false)
    expect(sendsClientHints('wss://example.com/')).toBe(false)
  })
})
