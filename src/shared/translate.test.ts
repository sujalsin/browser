import { describe, expect, it } from 'vitest'
import { batches, detectUrl, languageName, parseDetected, parseTranslations, sameLanguage, targetFromLocale, translateUrl } from './translate'

// Responses recorded from translate.googleapis.com (HTTP 200, application/json).
const SINGLE_HOLA =
  '[[["hello world","hola mundo",null,null,3,null,null,[[]],[[["d0311b314139639afa8d9993705f8a28","es_en_2023q1.md"]]]]],null,"es",null,null,null,1,[],[["es"],null,[1],["es"]]]'
const T_AUTO = '[["hello world","es"],["good morning","es"],["gracias","en"]]'
const T_FIXED = '["hello world","good morning"]'

describe('parsing real responses', () => {
  it('reads the detected language from translate_a/single', () => {
    expect(parseDetected(JSON.parse(SINGLE_HOLA))).toBe('es')
    expect(parseDetected({})).toBeNull()
    expect(parseDetected([[], null, null])).toBeNull()
  })

  it('reads translations with a fixed source language', () => {
    expect(parseTranslations(JSON.parse(T_FIXED), 2)).toEqual(['hello world', 'good morning'])
  })

  it('reads translations with sl=auto ([text, lang] pairs)', () => {
    expect(parseTranslations(JSON.parse(T_AUTO), 3)).toEqual(['hello world', 'good morning', 'gracias'])
  })

  it('accepts a bare string for a single text', () => {
    expect(parseTranslations('hello', 1)).toEqual(['hello'])
  })

  it('rejects a response whose count or shape does not match', () => {
    expect(parseTranslations(JSON.parse(T_FIXED), 3)).toBeNull()
    expect(parseTranslations({ error: 'nope' }, 1)).toBeNull()
    expect(parseTranslations([1, 2], 2)).toBeNull()
  })

  it('decodes HTML entities in results', () => {
    expect(parseTranslations(['Tom &amp; Jerry&#39;s &quot;show&quot; &lt;3'], 1)).toEqual(['Tom & Jerry\'s "show" <3'])
  })
})

describe('building requests', () => {
  it('encodes every text as its own q parameter', () => {
    expect(translateUrl('https://x', ['hola mundo', 'a&b'], 'es', 'en')).toBe('https://x/translate_a/t?client=gtx&sl=es&tl=en&q=hola%20mundo&q=a%26b')
  })

  it('limits the detection sample', () => {
    expect(detectUrl('https://x', 'a'.repeat(5000)).length).toBeLessThan(700)
  })

  it('splits texts so each request URL stays small', () => {
    const texts = Array.from({ length: 200 }, (_, i) => `sentence number ${i} `.repeat(4))
    const ranges = batches(texts)
    expect(ranges[0][0]).toBe(0)
    expect(ranges[ranges.length - 1][1]).toBe(200)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1]) // contiguous, nothing skipped
    for (const [a, b] of ranges) {
      expect(b - a).toBeLessThanOrEqual(60)
      expect(translateUrl('https://translate.googleapis.com', texts.slice(a, b), 'es', 'en').length).toBeLessThan(6500)
    }
  })

  it('gives CJK text (9 bytes per character encoded) smaller batches', () => {
    const texts = Array.from({ length: 50 }, () => '日本語のテキスト'.repeat(10))
    expect(batches(texts).length).toBeGreaterThan(5)
  })

  it('always makes progress, even for one huge text', () => {
    expect(batches(['x'.repeat(20000), 'y'])).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(batches([])).toEqual([])
  })
})

describe('languages', () => {
  it('picks a target from the system locale', () => {
    expect(targetFromLocale('en-US')).toBe('en')
    expect(targetFromLocale('pt-BR')).toBe('pt')
    expect(targetFromLocale('zh-TW')).toBe('zh-TW')
    expect(targetFromLocale('zh')).toBe('zh-CN')
    expect(targetFromLocale('xx-YY')).toBe('en')
  })

  it('compares language codes loosely', () => {
    expect(sameLanguage('en-GB', 'en')).toBe(true)
    expect(sameLanguage('es', 'en')).toBe(false)
    expect(sameLanguage('zh-CN', 'zh-TW')).toBe(false)
  })

  it('names languages', () => {
    expect(languageName('fr')).toBe('French')
    expect(languageName('pt-BR')).toBe('Portuguese')
    expect(languageName('xx')).toBe('xx')
  })
})
