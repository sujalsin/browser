import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { LittleState } from '../../shared/types'
import { displayHost } from '../../shared/url'
import { Icon } from './Icon'

const dispatch = window.browser.dispatch

/** Toolbar of a Little Arc window: navigation, address field, "Open in Browser". */
export function Little() {
  const [state, setState] = useState<LittleState | null>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => window.browser.onLittleState(setState), [])
  // A brand-new Little Arc has no page yet: start typing right away.
  useEffect(() => {
    if (state && !state.url && !editing) {
      setEditing(true)
      setText('')
      requestAnimationFrame(() => input.current?.focus())
    }
  }, [state?.url])

  if (!state) return null
  const style = { '--space': state.color } as CSSProperties

  return (
    <div className={`little ${state.platform}`} style={style}>
      <div className="little-bar">
        <div className="little-lights" />
        <button className="icon-btn" title="Back" disabled={!state.canGoBack} onClick={() => dispatch({ type: 'little.back' })}>
          <Icon name="back" size={15} />
        </button>
        <button className="icon-btn" title="Forward" disabled={!state.canGoForward} onClick={() => dispatch({ type: 'little.forward' })}>
          <Icon name="forward" size={15} />
        </button>
        <button className="icon-btn" title="Reload" disabled={!state.url} onClick={() => dispatch({ type: 'little.reload' })}>
          <Icon name="reload" size={14} />
        </button>
        {editing ? (
          <input
            ref={input}
            className="little-input"
            value={text}
            placeholder="Search or enter URL…"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => state.url && setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                dispatch({ type: 'little.navigate', input: text })
                setEditing(false)
              } else if (e.key === 'Escape' && state.url) {
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            className="little-url"
            title={state.url}
            onClick={() => {
              setText(state.url)
              setEditing(true)
              requestAnimationFrame(() => input.current?.select())
            }}
          >
            {state.loading && <span className="favicon spinner" />}
            <span className="little-title">{state.title && state.title !== state.url ? state.title : displayHost(state.url)}</span>
            <span className="little-host">{displayHost(state.url)}</span>
          </button>
        )}
        <button className="lib-button small little-open" title={`Move to ${state.spaceName} in the main window`} disabled={!state.url} onClick={() => dispatch({ type: 'little.toMain' })}>
          <Icon name="external" size={12} /> Open in Browser
        </button>
      </div>
    </div>
  )
}
