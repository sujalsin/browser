import { describe, expect, it } from 'vitest'
import { appLinkLabel, appLinkPermission, appLinkScheme, showAppLink } from './app-links'

describe('appLinkScheme', () => {
  it('recognises the links work apps use', () => {
    expect(appLinkScheme('zoommtg://zoom.us/join?confno=123')).toBe('zoommtg')
    expect(appLinkScheme('slack://channel?team=T1&id=C1')).toBe('slack')
    expect(appLinkScheme('mailto:someone@example.com?subject=Hi')).toBe('mailto')
    expect(appLinkScheme('MSTeams:/l/meetup-join/abc')).toBe('msteams')
    expect(appLinkScheme('  spotify:track:123')).toBe('spotify')
    expect(appLinkScheme('tel:+15551234567')).toBe('tel')
  })
  it('never lets a page reach file servers, remote sessions, local help or scripts', () => {
    for (const url of ['smb://evil.example/share', 'afp://evil.example/x', 'vnc://evil.example', 'ssh://root@evil.example', 'telnet://evil.example', 'x-man-page://1/ls', 'help:anchor=x', 'applescript://com.apple.scripteditor?action=new', 'itms-services://?action=download-manifest', 'SMB://EVIL/share']) {
      expect(appLinkScheme(url)).toBeNull()
    }
  })
  it('leaves the browser’s own kinds of address alone', () => {
    for (const url of ['https://example.com', 'http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'chrome://gpu', 'chrome-extension://abc/page.html', 'view-source:https://a.com', 'about:blank']) {
      expect(appLinkScheme(url)).toBeNull()
    }
  })
  it('refuses things that are not links', () => {
    for (const url of ['', 'zoom', '//zoom.us', ':x', '1abc:x', undefined, null, 7, 'zoommtg://' + 'x'.repeat(9000)]) expect(appLinkScheme(url)).toBeNull()
  })
})

describe('the rest', () => {
  it('remembers answers per kind of link', () => {
    expect(appLinkPermission('zoommtg')).toBe('openExternal:zoommtg')
    expect(appLinkLabel('openExternal:zoommtg')).toBe('Open app links (zoommtg)')
    expect(appLinkLabel('media')).toBeNull()
  })
  it('shows a link on one line without hidden characters', () => {
    expect(showAppLink('zoommtg://zoom.us/join\n\u202econfno=1\u0000')).toBe('zoommtg://zoom.us/joinconfno=1')
    const long = showAppLink('mailto:' + 'a'.repeat(300))
    expect(long).toHaveLength(90)
    expect(long.endsWith('…')).toBe(true)
  })
})
