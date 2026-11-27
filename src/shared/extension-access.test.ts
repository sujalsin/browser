import { describe, expect, it } from 'vitest'
import { describeExtensionAccess } from './extension-access'

describe('describeExtensionAccess', () => {
  it('says so plainly when an extension can read every site', () => {
    for (const manifest of [
      { host_permissions: ['<all_urls>'] },
      { host_permissions: ['*://*/*'] },
      { permissions: ['https://*/*', 'tabs'] },
      { content_scripts: [{ matches: ['http://*/*', 'https://*/*'] }] },
    ]) {
      expect(describeExtensionAccess(manifest)[0]).toMatch(/every website you visit/)
    }
  })
  it('names the sites when access is limited to a few', () => {
    const lines = describeExtensionAccess({ host_permissions: ['https://*.example.com/*', 'https://mail.example.org/*'] })
    expect(lines).toEqual(['Read and change what is on: example.com, mail.example.org'])
  })
  it('shortens long site lists', () => {
    const hosts = Array.from({ length: 9 }, (_, i) => `https://site${i}.com/*`)
    expect(describeExtensionAccess({ host_permissions: hosts })[0]).toMatch(/site5\.com and 3 more$/)
  })
  it('lists the other powers once each', () => {
    const lines = describeExtensionAccess({ permissions: ['cookies', 'webRequest', 'webRequestBlocking', 'storage', 'nativeMessaging', 'cookies'] })
    expect(lines).toEqual([
      'Read and change cookies, which includes your signed-in sessions',
      'Watch and change the network requests your pages make',
      'Talk to other apps on this computer',
    ])
  })
  it('handles a runtime request for more (chrome.permissions.request)', () => {
    expect(describeExtensionAccess({ permissions: ['history'], origins: ['https://*/*'] })).toEqual([
      'Read and change everything on every website you visit, including what you type',
      'Read and change your browsing history',
    ])
  })
  it('copes with missing or malformed manifests', () => {
    expect(describeExtensionAccess(null)).toEqual([])
    expect(describeExtensionAccess({})).toEqual([])
    expect(describeExtensionAccess({ permissions: 'tabs', content_scripts: [null, { matches: 7 }] })).toEqual([])
    expect(describeExtensionAccess({ permissions: [{ a: 1 }, 'storage'] })).toEqual([])
  })
})
