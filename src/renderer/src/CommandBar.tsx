import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ArchivedTab, Tab, UIState } from '../../shared/types'
import { SEARCH_ENGINES, displayHost, resolveInput } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { dispatch } from './useBrowserState'

type Result =
  | { kind: 'go'; input: string; url: string; isSearch: boolean }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'archive'; item: ArchivedTab; index: number }

const MAX_RESULTS = 8

function score(query: string, title: string, url: string): number {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  const u = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')
  if (t.startsWith(q) || u.startsWith(q)) return 3
  if (t.split(/\W+/).some((w) => w.startsWith(q))) return 2
  if (t.includes(q) || u.includes(q)) return 1
  return 0
}

function buildResults(state: UIState, input: string): Result[] {
  const query = input.trim()
  const results: Result[] = []
  if (!query) return results

  const url = resolveInput(query, state.searchEngine)
  if (url) {
    const isSearch = url.startsWith(SEARCH_ENGINES[state.searchEngine].template.split('%s')[0])
    results.push({ kind: 'go', input: query, url, isSearch })
  }

  const tabs = state.tabs
    .filter((t) => t.spaceId === state.activeSpaceId && t.id !== state.activeTabId)
    .map((tab) => ({ tab, s: score(query, tab.title, tab.url) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.tab.lastActiveAt - a.tab.lastActiveAt)
  for (const { tab } of tabs) results.push({ kind: 'tab', tab })

  const archived = state.archive
    .map((item, index) => ({ item, index, s: score(query, item.title, item.url) }))
    .filter((x) => x.s > 0 && x.item.spaceId === state.activeSpaceId)
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
    setSelected(0)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [openKey])

  const results = useMemo(() => buildResults(state, input), [state, input])
  if (!bar) return null

  const close = () => dispatch({ type: 'commandBar.close' })
  const run = (r: Result | undefined) => {
    if (!r) return
    if (r.kind === 'go') dispatch({ type: 'tab.open', input: r.input, mode: bar.mode })
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
      run(results[selected] ?? results[0])
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
              setSelected(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {results.length > 0 && (
          <ul className="command-results">
            {results.map((r, i) => (
              <li
                key={r.kind === 'tab' ? r.tab.id : r.kind === 'archive' ? `a${r.index}` : 'go'}
                className={`command-result ${i === selected ? 'selected' : ''}`}
                onMouseMove={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  run(r)
                }}
              >
                <ResultRow r={r} engine={SEARCH_ENGINES[state.searchEngine].name} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ResultRow({ r, engine }: { r: Result; engine: string }) {
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
  const item = r.kind === 'tab' ? r.tab : r.item
  return (
    <>
      <Favicon src={item.favicon} url={item.url} />
      <span className="result-title">{item.title || displayHost(item.url)}</span>
      <span className="result-meta">
        <Icon name={r.kind === 'tab' ? 'tab' : 'clock'} size={12} /> {r.kind === 'tab' ? 'Switch to Tab' : 'Archived'}
      </span>
    </>
  )
}
