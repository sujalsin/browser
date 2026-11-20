import { describe, expect, it } from 'vitest'
import { boostsFor, hideRule, normalizeDomain, selectorScript, wrapBoostScript } from './boosts'
import type { Boost } from './types'

const boost = (domain: string, enabled = true): Boost => ({ id: domain, domain, enabled, css: '', js: '', updated: 0 })

describe('normalizeDomain', () => {
  it('accepts domains and URLs', () => {
    expect(normalizeDomain('youtube.com')).toBe('youtube.com')
    expect(normalizeDomain('  https://www.YouTube.com/watch?v=1 ')).toBe('youtube.com')
    expect(normalizeDomain('news.ycombinator.com')).toBe('news.ycombinator.com')
    expect(normalizeDomain('localhost:3000')).toBe('localhost')
  })
  it('rejects junk', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('javascript:alert(1)')).toBeNull()
  })
})

describe('boostsFor', () => {
  const all = [boost('youtube.com'), boost('example.org', false), boost('docs.github.com')]
  it('matches the domain and its subdomains', () => {
    expect(boostsFor(all, 'https://www.youtube.com/watch').map((b) => b.domain)).toEqual(['youtube.com'])
    expect(boostsFor(all, 'https://m.youtube.com/').map((b) => b.domain)).toEqual(['youtube.com'])
    expect(boostsFor(all, 'https://docs.github.com/en').map((b) => b.domain)).toEqual(['docs.github.com'])
  })
  it('does not match look-alikes, parents, disabled boosts or non-web pages', () => {
    expect(boostsFor(all, 'https://notyoutube.com/')).toEqual([])
    expect(boostsFor(all, 'https://github.com/')).toEqual([])
    expect(boostsFor(all, 'https://example.org/')).toEqual([])
    expect(boostsFor(all, 'chrome-extension://abc/youtube.com')).toEqual([])
  })
})

describe('Zap helpers', () => {
  it('builds a hide rule', () => {
    expect(hideRule('#ad > div.banner')).toBe('#ad > div.banner { display: none !important; }')
  })
  it('selector script is valid JavaScript with rounded coordinates', () => {
    const src = selectorScript(10.6, 20.2)
    expect(src).toContain('elementFromPoint(11, 20)')
    expect(() => new Function(`return ${src}`)).not.toThrow()
  })
  it('wraps boost scripts so errors stay contained', () => {
    const src = wrapBoostScript('throw new Error("x")')
    expect(() => new Function(src)).not.toThrow()
    const errors: unknown[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => errors.push(a)
    try {
      new Function(src)()
    } finally {
      console.error = orig
    }
    expect(errors).toHaveLength(1)
  })
})
