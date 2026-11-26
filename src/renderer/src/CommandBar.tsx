import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ArchivedTab, HistoryItem, Tab, UIState } from '../../shared/types'
import { SEARCH_ENGINES, displayHost, resolveInput } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { dispatch } from './useBrowserState'

type Result =
  | { kind: 'go'; input: string; url: string; isSearch: boolean }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'archive'; item: ArchivedTab; index: number }
  | { kind: 'history'; item: HistoryItem }

const MAX_RESULTS = 8
/** Shown before anything is typed: the tabs you were on last. */
const MAX_RECENT = 5

function score(query: string, title: string, url: string): number {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const u = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')
  if (t.startsWith(q) || u.startsWith(q)) return 3
  if (t.split(/\W+/).some((w) => w.startsWith(q))) return 2
  if (t.includes(q) || u.includes(q)) return 1
  return 0
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function buildResults(state: UIState, input: string, history: HistoryItem[]): Result[] {
  const query = input.trim()
  const results: Result[] = []
  if (!query) {
    // Nothing typed yet: offer the tabs you used most recently here (this space's, and its favorites).
    const space = state.spaces.find((sp) => sp.id === state.activeSpaceId)
    const favorites = new Set(space ? (state.favorites[space.partition] ?? []) : [])
    return state.tabs
      .filter((t) => t.id !== state.activeTabId && t.lastActiveAt > 0 && (t.kind === 'favorite' ? favorites.has(t.id) : t.spaceId === state.activeSpaceId))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, MAX_RECENT)
      .map((tab) => ({ kind: 'tab', tab }))
  }

  const url = resolveInput(query, state.searchEngine)
  const go: Result | null = url
    ? { kind: 'go', input: query, url, isSearch: url.startsWith(SEARCH_ENGINES[state.searchEngine].template.split('%s')[0]) }
    : null

  // Typing the start of a site you visit ("gith") makes that site the Enter action, like Chrome.
  const typed = query.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  const best = !/\s/.test(query) ? history.find((h) => hostOf(h.url).startsWith(typed)) : undefined
  if (best) results.push({ kind: 'history', item: best })
  if (go) results.push(go)

  // Tabs from every space; the current space ranks first on ties.
  const here = (t: Tab) => (t.spaceId === state.activeSpaceId || t.kind === 'favorite' ? 1 : 0)
  // Private tabs only show up in search while you are in the private space.
  const privateSpaces = new Set(state.spaces.filter((s) => s.private).map((s) => s.id))
  const tabs = state.tabs
    .filter((t) => t.id !== state.activeTabId && (t.spaceId === state.activeSpaceId || !privateSpaces.has(t.spaceId)))
    .map((tab) => ({ tab, s: score(query, tab.title, tab.url) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || here(b.tab) - here(a.tab) || b.tab.lastActiveAt - a.tab.lastActiveAt)
  for (const { tab } of tabs) results.push({ kind: 'tab', tab })

  // History, minus pages already shown as an open tab or as the Enter action.
  const shown = new Set([...tabs.map((t) => t.tab.url), go?.url, best?.url])
  for (const item of history) if (!shown.has(item.url)) results.push({ kind: 'history', item })

  const archived = state.archive
    .map((item, index) => ({ item, index, s: score(query, item.title, item.url) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  for (const { item, index } of archived) results.push({ kind: 'archive', item, index })

  return results.slice(0, MAX_RESULTS)
}

export function CommandBar({ state }: { state: UIState }) {
  const bar = state.commandBar
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset every time the bar opens.
  const openKey = bar ? `${bar.mode}|${bar.initialInput}` : null
  useEffect(() => {
    if (!bar) return
    setInput(bar.initialInput)
    // With nothing typed the list is only a suggestion: Enter must not act on it until you pick a row.
    setSelected(bar.initialInput.trim() ? 0 : -1)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [openKey])

  // History suggestions come from the main process; ask shortly after typing pauses.
  const [history, setHistory] = useState<HistoryItem[]>([])
  useEffect(() => {
    const text = input.trim()
    if (!text) {
      setHistory([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      void window.browser.query<HistoryItem[]>({ type: 'history.suggest', input: text }).then((rows) => !stale && setHistory(rows ?? []))
    }, 40)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [input])

  const results = useMemo(() => buildResults(state, input, history), [state, input, history])
  if (!bar) return null

  const close = () => dispatch({ type: 'commandBar.close' })
  const run = (r: Result | undefined) => {
    if (!r) return
    if (r.kind === 'go') dispatch({ type: 'tab.open', input: r.input, mode: bar.mode })
    else if (r.kind === 'history') dispatch({ type: 'tab.open', input: r.item.url, mode: bar.mode })
    else if (r.kind === 'tab') {
      dispatch({ type: 'commandBar.close' })
      dispatch({ type: 'tab.activate', id: r.tab.id })
    } else {
      dispatch({ type: 'commandBar.close' })
      dispatch({ type: 'archive.restore', index: r.index })
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(selected >= 0 ? results[selected] : input.trim() ? results[0] : undefined)
    }
  }

  return (
    <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="command-bar" role="dialog" aria-label="Command bar">
        <div className="command-input-row">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="command-input"
            value={input}
            placeholder={bar.mode === 'edit' ? 'Enter URL or search' : 'Search or enter URL…'}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setInput(e.target.value)
              setSelected(e.target.value.trim() ? 0 : -1)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {results.length > 0 && (
          <ul className="command-results">
            {!input.trim() && <li className="command-label">Recent tabs</li>}
            {results.map((r, i) => (
              <li
                key={r.kind === 'tab' ? r.tab.id : r.kind === 'archive' ? `a${r.index}` : r.kind === 'history' ? `h${r.item.url}` : 'go'}
                className={`command-result ${i === selected ? 'selected' : ''}`}
                onMouseMove={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  run(r)
                }}
              >
                <ResultRow r={r} engine={SEARCH_ENGINES[state.searchEngine].name} state={state} />
              </li>
            ))}
          </ul>
        )}
        {results.length > 0 && (
          <footer className="command-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> to choose
            </span>
            <span>
              <kbd>↵</kbd> to open
            </span>
            <span>
              <kbd>esc</kbd> to close
            </span>
          </footer>
        )}
      </div>
    </div>
  )
}

function ResultRow({ r, engine, state }: { r: Result; engine: string; state: UIState }) {
  if (r.kind === 'go') {
    return (
      <>
        <span className="result-icon">
          <Icon name={r.isSearch ? 'search' : 'globe'} />
        </span>
        <span className="result-title">{r.input}</span>
        <span className="result-meta">{r.isSearch ? `${engine} Search` : displayHost(r.url)}</span>
      </>
    )
  }
  if (r.kind === 'history') {
    return (
      <>
        <Favicon src={r.item.favicon ?? undefined} url={r.item.url} />
        <span className="result-title">{r.item.title || displayHost(r.item.url)}</span>
        <span className="result-meta">{displayHost(r.item.url)}</span>
      </>
    )
  }
  const item = r.kind === 'tab' ? r.tab : r.item
  const elsewhere = item.spaceId !== state.activeSpaceId && !(r.kind === 'tab' && r.tab.kind === 'favorite')
  const spaceName = state.spaces.find((s) => s.id === item.spaceId)?.name
  return (
    <>
      <Favicon src={item.favicon} url={item.url} />
      <span className="result-title">{item.title || displayHost(item.url)}</span>
      <span className="result-meta">
        <Icon name={r.kind === 'tab' ? 'tab' : 'clock'} size={12} /> {r.kind === 'tab' ? 'Switch to Tab' : 'Archived'}
        {elsewhere && spaceName ? ` · ${spaceName}` : ''}
      </span>
    </>
  )
}
