import { useEffect, useRef, useState } from 'react'
import { themeStyle } from './App'
import { Icon } from './Icon'
import { dispatch, useBrowserState } from './useBrowserState'

/** Find-in-page bar (⌘F). Lives in its own small view over the top-right of the page. */
export function FindBar() {
  const state = useBrowserState()
  const find = state?.find
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // ⌘F again (or reopening) focuses and selects the text, like every browser.
  useEffect(() => {
    if (!find) return
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.select()
    })
  }, [find?.focusToken])

  if (!state || !find) return null
  const status = !text ? '' : find.total ? `${find.active}/${find.total}` : 'No results'

  return (
    <div className={`find-root ${state.platform}`} style={themeStyle(state)}>
      <div className="find-bar" role="search">
        <Icon name="search" size={14} />
        <input
          ref={input}
          className="find-input"
          value={text}
          placeholder="Find in page"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            dispatch({ type: 'find.query', text: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              dispatch({ type: 'find.query', text, forward: !e.shiftKey, next: true })
            } else if (e.key === 'Escape') {
              e.preventDefault()
              dispatch({ type: 'find.close' })
            }
          }}
        />
        <span className={`find-status ${text && !find.total ? 'none' : ''}`}>{status}</span>
        <button className="icon-btn small-visible" title="Previous (⇧⌘G)" disabled={!find.total} onClick={() => dispatch({ type: 'find.query', text, forward: false, next: true })}>
          <Icon name="up" size={14} />
        </button>
        <button className="icon-btn small-visible" title="Next (⌘G)" disabled={!find.total} onClick={() => dispatch({ type: 'find.query', text, forward: true, next: true })}>
          <Icon name="down" size={14} />
        </button>
        <button className="icon-btn small-visible" title="Close (Esc)" onClick={() => dispatch({ type: 'find.close' })}>
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  )
}
