import { describe, expect, it } from 'vitest'
import { engineStatus, engineUpdateDue, parseEngineVersion } from './engine'

describe('parseEngineVersion', () => {
  it('reads release tags', () => {
    expect(parseEngineVersion('v45.2.1+wvcus')).toEqual([45, 2, 1])
    expect(parseEngineVersion('45.10.0+wvcus')).toEqual([45, 10, 0])
  })
  it('ignores test releases and other flavours', () => {
    for (const tag of ['v46.0.0-alpha.7+wvcus', 'v45.0.0-beta.1+wvcus', 'v5.0.13-wvvmp', 'v45.2.1', 'latest', '', null, 45, 'v45.2.1+wvcus; rm -rf /']) {
      expect(parseEngineVersion(tag)).toBeNull()
    }
  })
})

describe('engineStatus', () => {
  const tags = ['v43.8.6+wvcus', 'v44.1.0+wvcus', 'v44.10.1+wvcus', 'v44.9.3+wvcus', 'v45.0.0-alpha.14+wvcus', 'v45.2.1+wvcus', 'v46.0.0-alpha.7+wvcus']

  it('is quiet when nothing newer exists (test releases do not count)', () => {
    const s = engineStatus('45.2.1+wvcus', tags)
    expect(s).toEqual({ update: null, nextLine: null, supported: true })
    expect(engineUpdateDue(s)).toBeNull()
  })
  it('offers the newest release of the same line, comparing numbers and not text', () => {
    const s = engineStatus('44.9.3+wvcus', tags)
    expect(s.update).toBe('44.10.1')
    expect(s.nextLine).toBe('45.2.1')
    expect(s.supported).toBe(true)
    expect(engineUpdateDue(s)).toBe('44.10.1')
  })
  it('mentions a newer line without pushing it while the current one is still patched', () => {
    const s = engineStatus('45.2.1+wvcus', [...tags, 'v46.1.0+wvcus', 'v47.0.2+wvcus'])
    expect(s).toEqual({ update: null, nextLine: '47.0.2', supported: true })
    expect(engineUpdateDue(s)).toBeNull()
  })
  it('pushes the newer line once the current one is abandoned', () => {
    const s = engineStatus('45.2.1+wvcus', [...tags, 'v48.0.1+wvcus'])
    expect(s.supported).toBe(false)
    expect(engineUpdateDue(s)).toBe('48.0.1')
  })
  it('prefers a same-line fix even then', () => {
    expect(engineUpdateDue(engineStatus('45.2.1+wvcus', [...tags, 'v45.3.0+wvcus', 'v48.0.1+wvcus']))).toBe('45.3.0')
  })
  it('stays quiet rather than guess when it cannot tell', () => {
    expect(engineStatus('45.2.1+wvcus', [])).toEqual({ update: null, nextLine: null, supported: true })
    expect(engineStatus('not a version', tags)).toEqual({ update: null, nextLine: null, supported: true })
    expect(engineStatus('45.2.1+wvcus', [null, {}, 'junk'])).toEqual({ update: null, nextLine: null, supported: true })
  })
  it('accepts a version reported without the flavour', () => {
    expect(engineStatus('44.9.3', tags).update).toBe('44.10.1')
  })
})
