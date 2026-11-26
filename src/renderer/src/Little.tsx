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

  useEffect(() => {
    const off = window.browser.onLittleState(setState)
    // Ask for the current state now that we are listening: a popup's page was
    // loaded before this toolbar existed, so nothing else would tell us about it.
    dispatch({ type: 'little.ready' })
    return off
  }, [])
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

  // A window a site opened itself (sign-in and the like): say whose page it is, nothing more.
  if (state.popup) {
    const secure = state.url.startsWith('https://')
    return (
      <div className={`little ${state.platform}`} style={style}>
        <div className="little-bar popup">
          <div className="little-lights" />
          <div className="little-site" title={state.url}>
            {state.loading ? <span className="favicon spinner" /> : <Icon name={secure ? 'lock' : 'info'} size={13} className={secure ? '' : 'insecure'} />}
            <span className="little-site-host">{displayHost(state.url) || 'Loading…'}</span>
            {state.title && state.title !== state.url && <span className="little-host">{state.title}</span>}
          </div>
        </div>
      </div>
    )
  }

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
