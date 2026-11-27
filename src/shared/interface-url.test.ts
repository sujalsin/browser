import { describe, expect, it } from 'vitest'
import { isInterfaceUrl, isOpenableLink } from './interface-url'

const FILE = 'file:///Applications/Browser.app/Contents/Resources/app.asar/out/renderer/index.html'
const DEV = 'http://localhost:5173'

describe('isInterfaceUrl', () => {
  it('accepts the interface document and its views', () => {
    expect(isInterfaceUrl(FILE, FILE)).toBe(true)
    expect(isInterfaceUrl(`${FILE}#overlay`, FILE)).toBe(true)
    expect(isInterfaceUrl(`${FILE}#find`, FILE)).toBe(true)
    expect(isInterfaceUrl(`${FILE}#little`, FILE)).toBe(true)
  })
  it('accepts the development server address with or without the trailing slash', () => {
    expect(isInterfaceUrl('http://localhost:5173/', DEV)).toBe(true)
    expect(isInterfaceUrl('http://localhost:5173/#overlay', DEV)).toBe(true)
  })
  it('refuses websites', () => {
    expect(isInterfaceUrl('https://example.com/', FILE)).toBe(false)
    expect(isInterfaceUrl('http://localhost:8765/login.html', FILE)).toBe(false)
    expect(isInterfaceUrl('http://localhost:5173.evil.example/', DEV)).toBe(false)
    expect(isInterfaceUrl('http://localhost:5174/', DEV)).toBe(false)
  })
  it('refuses other files on the computer', () => {
    expect(isInterfaceUrl('file:///Users/me/Downloads/page.html', FILE)).toBe(false)
    expect(isInterfaceUrl(FILE.replace('index.html', 'other.html'), FILE)).toBe(false)
    expect(isInterfaceUrl('file:///Applications/Browser.app/Contents/Resources/app.asar/out/renderer/index.html.html', FILE)).toBe(false)
  })
  it('refuses empty and broken addresses', () => {
    expect(isInterfaceUrl('', FILE)).toBe(false)
    expect(isInterfaceUrl(undefined, FILE)).toBe(false)
    expect(isInterfaceUrl('about:blank', FILE)).toBe(false)
    expect(isInterfaceUrl('javascript:alert(1)', FILE)).toBe(false)
    expect(isInterfaceUrl('not a url', FILE)).toBe(false)
  })
})

describe('isOpenableLink', () => {
  it('accepts web addresses', () => {
    expect(isOpenableLink('https://example.com/a?b=c')).toBe(true)
    expect(isOpenableLink('http://localhost:3000')).toBe(true)
    expect(isOpenableLink('HTTPS://EXAMPLE.COM')).toBe(true)
  })
  it('refuses everything else another app could hand over', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'chrome://settings', 'view-source:https://a.com', 'smb://server/share', 'https://', 'https:// evil', '', undefined, null, 42, { url: 'https://a.com' }]) {
      expect(isOpenableLink(url)).toBe(false)
    }
    expect(isOpenableLink('https://a.com/' + 'x'.repeat(9000))).toBe(false)
  })
})
