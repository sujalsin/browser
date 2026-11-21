import { describe, expect, it } from 'vitest'
import { isolateScriptlets } from './scriptlets'

type Scope = Record<string, unknown>
const g = globalThis as unknown as Scope
const run = (code: string) => (0, eval)(code) as unknown

// Shaped like what the filter engine emits: shared helper declarations first,
// then the scriptlet's own call. The helper wraps a function and patches a
// shared "toString" so that the wrapper looks like the original, the way uBlock
// Origin's proxyApplyFn patches Function.prototype.toString.
const scriptlet = (target: string) => `
if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; };
function patch(name) {
  if (patch.original === undefined) {
    patch.original = host.describe;
    host.describe = function (fn) { return patch.original(fn) };
  }
  host[name] = host[name];
};
patch(${JSON.stringify(target)})`

describe('isolateScriptlets', () => {
  it('reproduces the problem when scriptlets share the global scope', () => {
    g.host = { describe: (fn: unknown) => typeof fn, a: 1, b: 2 }
    try {
      run(scriptlet('a'))
      run(scriptlet('b'))
      // The second copy of patch() replaced the first, whose wrapper now calls itself.
      expect(() => (g.host as { describe: (x: unknown) => string }).describe(1)).toThrow(RangeError)
    } finally {
      for (const key of ['host', 'patch', 'scriptletGlobals']) delete g[key]
    }
  })

  it('keeps each scriptlet’s helpers to itself', () => {
    g.host = { describe: (fn: unknown) => typeof fn, a: 1, b: 2 }
    try {
      run(isolateScriptlets([scriptlet('a'), scriptlet('b'), scriptlet('a')]))
      expect((g.host as { describe: (x: unknown) => string }).describe(1)).toBe('number')
      expect(g.patch).toBeUndefined()
      expect(g.scriptletGlobals).toBeUndefined()
    } finally {
      delete g.host
    }
  })

  it('a failing scriptlet does not stop the next one', () => {
    g.ran = [] as string[]
    try {
      run(isolateScriptlets(['ran.push("one"); throw new Error("boom")', 'ran.push("two")']))
      expect(g.ran).toEqual(['one', 'two'])
    } finally {
      delete g.ran
    }
  })

  it('copes with a scriptlet ending in a line comment', () => {
    g.ran = [] as string[]
    try {
      run(isolateScriptlets(['ran.push("one") // done', 'ran.push("two")']))
      expect(g.ran).toEqual(['one', 'two'])
    } finally {
      delete g.ran
    }
  })

  it('is empty for no scriptlets', () => {
    expect(isolateScriptlets([])).toBe('')
  })
})
