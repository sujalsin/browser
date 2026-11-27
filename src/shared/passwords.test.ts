import { describe, expect, it } from 'vitest'
import { loginOrigin, parseCsv, parsePasswordCsv, passwordToSave, toPasswordCsv } from './passwords'

describe('where a password belongs', () => {
  it('is the origin of an https page', () => {
    expect(loginOrigin('https://accounts.example.com/signin?x=1#top')).toBe('https://accounts.example.com')
    expect(loginOrigin('https://example.com:8443/')).toBe('https://example.com:8443')
  })

  it('plain http only on this computer', () => {
    expect(loginOrigin('http://localhost:3000/login')).toBe('http://localhost:3000')
    expect(loginOrigin('http://127.0.0.1/')).toBe('http://127.0.0.1')
    expect(loginOrigin('http://example.com/login')).toBeNull()
  })

  it('nothing else', () => {
    for (const url of ['', 'not a url', 'file:///etc/passwd', 'chrome-extension://abc/popup.html', 'about:blank', 'android://hash@com.app/']) {
      expect(loginOrigin(url)).toBeNull()
    }
  })
})

describe('CSV', () => {
  it('handles quotes, commas, doubled quotes and line breaks inside fields', () => {
    expect(parseCsv('a,b\n"x,1","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"'],
      ['two\nlines', 'z'],
    ])
  })

  it('handles Windows line ends, a byte-order mark and a missing final line break', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps empty fields and skips blank lines', () => {
    expect(parseCsv('a,,c\n\n,,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })
})

describe('a password file from Arc or Chrome', () => {
  // The layout Chromium browsers export.
  const FILE = [
    'name,url,username,password,note',
    'example.com,https://example.com/login,me@example.com,"p,a""ss word",',
    'shop,https://shop.example.org/,sam,hunter2,my note',
    'router,http://192.168.1.1/,admin,admin,',
    'app,android://abc@com.example.app/,me,secret,',
    'empty,https://nopass.example.com/,me,,',
    'local,http://localhost:8080/admin,dev,devpass,',
  ].join('\n')

  it('reads the logins it can use', () => {
    const { logins, skipped } = parsePasswordCsv(FILE)
    expect(logins).toEqual([
      { origin: 'https://example.com', username: 'me@example.com', password: 'p,a"ss word' },
      { origin: 'https://shop.example.org', username: 'sam', password: 'hunter2' },
      { origin: 'http://localhost:8080', username: 'dev', password: 'devpass' },
    ])
    expect(skipped).toBe(3) // plain http on a network device, an Android app, an empty password
  })

  it('finds the columns by name, in any order', () => {
    expect(parsePasswordCsv('password,username,url\npw,me,https://a.example/\n').logins).toEqual([{ origin: 'https://a.example', username: 'me', password: 'pw' }])
  })

  it('keeps spaces inside a password', () => {
    expect(parsePasswordCsv('url,username,password\nhttps://a.example/,me," two  spaces "\n').logins[0].password).toBe(' two  spaces ')
  })

  it('refuses a file that is not a password export', () => {
    expect(parsePasswordCsv('title,body\nhello,world\n')).toEqual({ logins: [], skipped: 1 })
    expect(parsePasswordCsv('')).toEqual({ logins: [], skipped: 0 })
  })
})

describe('a backup of the saved passwords', () => {
  const logins = [
    { origin: 'https://example.com', username: 'sam@example.com', password: 'correct horse battery' },
    { origin: 'https://shop.example.org', username: 'sam, the "boss"', password: ' lead,ing "quote"\nnew line ' },
    { origin: 'http://localhost:3000', username: '', password: '=SUM(1)' },
  ]
  it('reads back exactly what was written, awkward characters included', () => {
    expect(parsePasswordCsv(toPasswordCsv(logins))).toEqual({ logins: [logins[0], { ...logins[1], username: 'sam, the "boss"' }, logins[2]], skipped: 0 })
  })
  it('is the layout Chrome, Arc and Bitwarden import', () => {
    expect(toPasswordCsv([logins[0]])).toBe('name,url,username,password\nexample.com,https://example.com/,sam@example.com,correct horse battery\n')
  })
  it('an empty list is just the heading', () => {
    expect(toPasswordCsv([])).toBe('name,url,username,password\n')
  })
})

describe('which password field to remember', () => {
  it('the only one', () => {
    expect(passwordToSave(['secret'])).toBe('secret')
    expect(passwordToSave(['', 'secret'])).toBe('secret')
  })

  it('the repeated new one on sign-up and change-password forms', () => {
    expect(passwordToSave(['new', 'new'])).toBe('new')
    expect(passwordToSave(['old', 'new', 'new'])).toBe('new')
  })

  it('the first when two differ', () => {
    expect(passwordToSave(['one', 'two'])).toBe('one')
  })

  it('nothing when all are empty', () => {
    expect(passwordToSave(['', ''])).toBe('')
    expect(passwordToSave([])).toBe('')
  })
})
