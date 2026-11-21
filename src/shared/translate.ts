// Page translation helpers (no Electron, no network): unit-tested against
// responses recorded from Google's public translate endpoint.

/** Languages offered as translation targets. */
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  pl: 'Polish',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  el: 'Greek',
  tr: 'Turkish',
  ru: 'Russian',
  uk: 'Ukrainian',
  he: 'Hebrew',
  ar: 'Arabic',
  fa: 'Persian',
  hi: 'Hindi',
  bn: 'Bengali',
  gu: 'Gujarati',
  mr: 'Marathi',
  ta: 'Tamil',
  te: 'Telugu',
  ur: 'Urdu',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
}

export function languageName(code: string): string {
  return LANGUAGES[code] ?? LANGUAGES[code.split('-')[0]] ?? code
}

/** Default target language from a locale such as "en-US" or "zh-TW". */
export function targetFromLocale(locale: string): string {
  if (LANGUAGES[locale]) return locale
  const base = locale.split('-')[0].toLowerCase()
  if (base === 'zh') return /TW|HK|Hant/i.test(locale) ? 'zh-TW' : 'zh-CN'
  return LANGUAGES[base] ? base : 'en'
}

/** Do two language codes mean the same language ("en-GB" vs "en")? */
export function sameLanguage(a: string, b: string): boolean {
  const norm = (c: string) => (c.toLowerCase().startsWith('zh') ? c.toLowerCase() : c.split('-')[0].toLowerCase())
  return norm(a) === norm(b)
}

export const TRANSLATE_BASE = 'https://translate.googleapis.com'
/** Requests are GETs, so each one's URL must stay well under server limits. */
const MAX_QUERY_CHARS = 5500
const MAX_ITEMS = 60

/**
 * Split texts into batches whose URL-encoded size fits in one request.
 * Returns index ranges [start, end) into `texts`.
 */
export function batches(texts: string[]): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  let size = 0
  for (let i = 0; i < texts.length; i++) {
    const cost = encodeURIComponent(texts[i]).length + 3 // "&q="
    if (i > start && (size + cost > MAX_QUERY_CHARS || i - start >= MAX_ITEMS)) {
      out.push([start, i])
      start = i
      size = 0
    }
    size += cost
  }
  if (start < texts.length) out.push([start, texts.length])
  return out
}

/** URL asking which language a sample of text is in. */
export function detectUrl(base: string, sample: string): string {
  return `${base}/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(sample.slice(0, 600))}`
}

/** Detected source language from a `translate_a/single` response: `[[…segments…], null, "es", …]`. */
export function parseDetected(json: unknown): string | null {
  const lang = Array.isArray(json) ? json[2] : null
  return typeof lang === 'string' && lang ? lang : null
}

/** URL translating several texts at once. */
export function translateUrl(base: string, texts: string[], from: string, to: string): string {
  const q = texts.map((t) => `&q=${encodeURIComponent(t)}`).join('')
  return `${base}/translate_a/t?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}${q}`
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Translations from a `translate_a/t` response. With a known source language
 * it is `["hello", "good morning"]`; with sl=auto, `[["hello", "es"], …]`; a
 * single text may come back as a bare string. Returns null if the shape or
 * count is not what was asked for (the caller then leaves those texts alone).
 */
export function parseTranslations(json: unknown, expected: number): string[] | null {
  const items = typeof json === 'string' ? [json] : json
  if (!Array.isArray(items) || items.length !== expected) return null
  const out: string[] = []
  for (const item of items) {
    const text = typeof item === 'string' ? item : Array.isArray(item) && typeof item[0] === 'string' ? item[0] : null
    if (text === null) return null
    out.push(decodeEntities(text))
  }
  return out
}

/** Fallback when in-place translation fails: Google Translate's own page viewer. */
export function googleTranslatePageUrl(pageUrl: string, to: string): string {
  return `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(to)}&u=${encodeURIComponent(pageUrl)}`
}
