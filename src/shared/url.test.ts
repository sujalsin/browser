import { describe, expect, it } from 'vitest'
import { displayHost, resolveInput } from './url'

const r = (s: string) => resolveInput(s, 'google')
const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`

describe('resolveInput', () => {
  it('returns null for empty input', () => {
    expect(r('')).toBeNull()
    expect(r('   ')).toBeNull()
  })

  it('keeps full URLs', () => {
    expect(r('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(r('http://example.com')).toBe('http://example.com/')
  })

  it('adds https to bare domains', () => {
    expect(r('example.com')).toBe('https://example.com')
    expect(r('news.ycombinator.com/item?id=1')).toBe('https://news.ycombinator.com/item?id=1')
    expect(r('bbc.co.uk')).toBe('https://bbc.co.uk')
  })

  it('uses http for localhost, IPs and host:port', () => {
    expect(r('localhost')).toBe('http://localhost')
    expect(r('localhost:3000/app')).toBe('http://localhost:3000/app')
    expect(r('192.168.1.1')).toBe('http://192.168.1.1')
    expect(r('myserver:8080')).toBe('http://myserver:8080')
  })

  it('searches for words and phrases', () => {
    expect(r('hello')).toBe(search('hello'))
    expect(r('how to cook rice')).toBe(search('how to cook rice'))
    expect(r('example.com is down')).toBe(search('example.com is down'))
    expect(r('node.js')).toBe('https://node.js') // looks like a domain — same as Chrome
    expect(r('3.14')).toBe(search('3.14'))
  })

  it('never loads javascript: URLs', () => {
    expect(r('javascript:alert(1)')).toBeNull()
  })

  it('searches for unsupported schemes', () => {
    expect(r('mailto:a@b.com')).toBe(search('mailto:a@b.com'))
  })

  it('uses the selected engine', () => {
    expect(resolveInput('cats', 'duckduckgo')).toBe('https://duckduckgo.com/?q=cats')
  })
})

describe('displayHost', () => {
  it('strips www and path', () => {
    expect(displayHost('https://www.github.com/foo')).toBe('github.com')
  })
  it('passes through non-web URLs', () => {
    expect(displayHost('about:blank')).toBe('about:blank')
  })
})
