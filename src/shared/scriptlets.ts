// Scriptlets are the small scripts filter lists run inside a page ("##+js(…)"
// rules): they stop an ad script from starting, remove ad data from a response,
// and so on. The filter engine hands them over as separate pieces of code.

/** A page asks (and waits) for its scriptlets as it starts. Answer: one script, or ''. */
export const SCRIPTLETS_CHANNEL = 'shields:scriptlets'
/** The same question from a frame inside a page, which doesn't wait for the answer. */
export const SCRIPTLETS_LATER_CHANNEL = 'shields:scriptlets-later'

/**
 * Combine a page's scriptlets into one script, each in a scope of its own.
 *
 * Every scriptlet carries its own copy of uBlock Origin's helper functions
 * (`safeSelf`, `proxyApplyFn`, …) as plain declarations. Run as they come, each
 * one replaces the previous one's helpers in the page's global scope, and two
 * scriptlets that both wrap a built-in function then call each other forever:
 * `Function.prototype.toString` throws "Maximum call stack size exceeded" for
 * the whole page. (That is what broke Netflix, which has three such rules.)
 * Scoped, nothing leaks into the page, and one scriptlet failing doesn't stop
 * the others.
 */
export function isolateScriptlets(scripts: string[]): string {
  return scripts.map((script) => `try{(function(){${script}\n})()}catch(e){}`).join('\n')
}
