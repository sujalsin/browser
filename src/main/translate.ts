import { net, type WebContents } from 'electron'
import { TRANSLATE_BASE, batches, detectUrl, parseDetected, parseTranslations, sameLanguage, translateUrl } from '../shared/translate'

/**
 * Translates a page in place (Chrome's "Translate this page"). The page's
 * visible text is sent to Google Translate in batches and swapped in as the
 * answers arrive; nothing is sent until you ask for a translation.
 *
 * Page scripts run in their own JavaScript world: they share the DOM with the
 * page but not its variables, so the site can't see or tamper with them.
 */
const WORLD = 4242
const MAX_NODES = 6000
const PARALLEL = 3

/** Tests point this at a local stand-in server. */
const BASE = process.env.BROWSER_TRANSLATE_BASE || TRANSLATE_BASE

// Finds text worth translating, remembers the nodes, returns their trimmed text.
// Nodes found by an earlier run are skipped, so running it again only picks up
// content the page added since (infinite scroll, comments, …).
const COLLECT = `(() => {
  const st = (globalThis.__translate ??= { nodes: [], originals: [], seen: new WeakSet() })
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'SVG', 'MATH', 'KBD', 'SAMP'])
  const start = st.nodes.length
  const texts = []
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode()) && st.nodes.length < ${MAX_NODES}) {
    if (st.seen.has(node)) continue
    const value = node.nodeValue
    const text = value.trim()
    if (text.length < 2 || !/\\p{L}/u.test(text)) continue
    let el = node.parentElement, ok = true
    for (; el; el = el.parentElement) {
      if (skip.has(el.tagName.toUpperCase()) || el.isContentEditable || el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) { ok = false; break }
    }
    if (!ok) continue
    st.seen.add(node)
    st.nodes.push(node)
    st.originals.push(value)
    texts.push(text)
  }
  return { start, texts, lang: document.documentElement.lang || '', sample: texts.join(' ').slice(0, 600) }
})()`

const applyScript = (start: number, translations: string[]) => `(() => {
  const st = globalThis.__translate
  if (!st) return 0
  const out = ${JSON.stringify(translations)}
  let n = 0
  out.forEach((t, i) => {
    const node = st.nodes[${start} + i], original = st.originals[${start} + i]
    if (!node || t == null) return
    // Keep the spacing the original text had around it.
    node.nodeValue = original.match(/^\\s*/)[0] + t + original.match(/\\s*$/)[0]
    n++
  })
  return n
})()`

const RESTORE = `(() => {
  const st = globalThis.__translate
  if (!st) return 0
  st.nodes.forEach((node, i) => { node.nodeValue = st.originals[i] })
  const n = st.nodes.length
  delete globalThis.__translate
  return n
})()`

export type TranslateResult =
  | { ok: true; from: string; translated: number }
  | { ok: false; reason: 'same-language' | 'nothing' | 'failed'; from?: string; detail?: string }

async function getJson(url: string): Promise<unknown> {
  const res = await net.fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`translation service answered ${res.status}`)
  return res.json()
}

const inPage = (wc: WebContents, code: string) => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }])

export async function translatePage(wc: WebContents, to: string): Promise<TranslateResult> {
  const found = (await inPage(wc, COLLECT)) as { start: number; texts: string[]; lang: string; sample: string }
  if (!found.texts.length) return { ok: false, reason: 'nothing' }

  // Detect the language once for the whole page: per-phrase detection gets short
  // phrases wrong (it calls "gracias" English). The page's own lang attribute is
  // only a fallback, because many sites leave it as "en" whatever the content is.
  let from = 'auto'
  try {
    from = parseDetected(await getJson(detectUrl(BASE, found.sample))) ?? (found.lang.trim() || 'auto')
  } catch {
    from = found.lang.trim() || 'auto'
  }
  if (from !== 'auto' && sameLanguage(from, to)) {
    await inPage(wc, RESTORE) // forget the nodes we just collected
    return { ok: false, reason: 'same-language', from }
  }

  const ranges = batches(found.texts)
  let translated = 0
  let failure: string | undefined
  let next = 0
  const worker = async () => {
    while (next < ranges.length && !wc.isDestroyed()) {
      const [a, b] = ranges[next++]
      const texts = found.texts.slice(a, b)
      try {
        const result = parseTranslations(await getJson(translateUrl(BASE, texts, from, to)), texts.length)
        if (!result) throw new Error('unexpected response from the translation service')
        if (!wc.isDestroyed()) translated += (await inPage(wc, applyScript(found.start + a, result))) as number
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker))

  if (!translated) return { ok: false, reason: 'failed', from, detail: failure }
  return { ok: true, from, translated }
}

/** Put the original text back. */
export async function restorePage(wc: WebContents): Promise<void> {
  if (!wc.isDestroyed()) await inPage(wc, RESTORE).catch(() => {})
}
