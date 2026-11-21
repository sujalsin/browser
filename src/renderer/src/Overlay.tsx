import { useEffect, useRef, useState } from 'react'
import { themeStyle } from './App'
import { Sidebar } from './Sidebar'
import { CommandBar } from './CommandBar'
import { Library } from './Library'
import { displayHost } from '../../shared/url'
import { Favicon } from './Favicon'
import { Icon } from './Icon'
import { dispatch, useBrowserState } from './useBrowserState'

/**
 * Content of the transparent overlay view that sits above web pages:
 * the command bar, or the sidebar peeking in while it is hidden.
 */
export function Overlay() {
  const state = useBrowserState()
  if (!state) return null
  return (
    <div className={`overlay-root ${state.platform} ${state.spaces.find((s) => s.id === state.activeSpaceId)?.private ? 'private' : ''}`} style={themeStyle(state)}>
      {state.auth ? (
        <AuthPrompt key={`${state.auth.host}|${state.auth.realm}`} state={state} />
      ) : state.splitDragging ? (
        <SplitDragSurface state={state} />
      ) : state.commandBar ? (
        <CommandBar state={state} />
      ) : state.library ? (
        <Library state={state} />
      ) : state.preview ? (
        <PreviewChrome state={state} />
      ) : state.peek ? (
        <PeekSidebar state={state} />
      ) : null}
    </div>
  )
}

function PeekSidebar({ state }: { state: Parameters<typeof Sidebar>[0]['state'] }) {
  const closeTimer = useRef<number | undefined>(undefined)
  const close = () => {
    window.clearTimeout(closeTimer.current)
    // A short grace period so brushing past the edge doesn't flicker it shut.
    closeTimer.current = window.setTimeout(() => dispatch({ type: 'sidebar.peek', open: false }), 180)
  }
  const keep = () => window.clearTimeout(closeTimer.current)

  useEffect(() => {
    // The pointer can leave the whole view without a mouseleave on the panel.
    const onLeave = (e: MouseEvent) => {
      if (!e.relatedTarget) close()
    }
    document.addEventListener('mouseout', onLeave)
    return () => {
      document.removeEventListener('mouseout', onLeave)
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  return (
    <div className="peek-panel" onMouseLeave={close} onMouseEnter={keep}>
      <Sidebar state={state} />
    </div>
  )
}

/** Covers the window while the split divider is dragged, so the pages don't swallow the mouse. */
function SplitDragSurface({ state }: { state: Parameters<typeof Sidebar>[0]['state'] }) {
  const split = state.splitView
  const frame = useRef(0)
  if (!split) return null
  const [a, b] = split.panes
  const gap = b.x - (a.x + a.width)
  const left = a.x
  const total = b.x + b.width - a.x - gap
  const end = () => dispatch({ type: 'split.drag', active: false })
  return (
    <div
      className="split-drag-surface"
      onMouseMove={(e) => {
        const x = e.clientX
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => dispatch({ type: 'split.resize', id: split.id, ratio: (x - left - gap / 2) / total }))
      }}
      onMouseUp={end}
      onMouseLeave={end}
    />
  )
}

/** Peek: dimmed backdrop, a toolbar above the floating page, and its shadow. */
function PreviewChrome({ state }: { state: Parameters<typeof Sidebar>[0]['state'] }) {
  const p = state.preview!
  const r = p.rect
  const close = () => dispatch({ type: 'preview.close' })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="preview-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="preview-shadow" style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />
      <div className="preview-toolbar" style={{ left: r.x, top: r.y - 46, width: r.width }}>
        <button className="icon-btn" title="Back" disabled={!p.canGoBack} onClick={() => dispatch({ type: 'preview.back' })}>
          <Icon name="back" size={15} />
        </button>
        <Favicon url={p.url} loading={p.loading} />
        <span className="preview-title">{p.title && p.title !== p.url ? p.title : displayHost(p.url)}</span>
        <span className="preview-host">{displayHost(p.url)}</span>
        <button className="lib-button small" title="Keep reading in a new tab" onClick={() => dispatch({ type: 'preview.toTab' })}>
          <Icon name="external" size={12} /> Open in New Tab
        </button>
        <button className="icon-btn" title="Close (Esc)" onClick={close}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  )
}

/** A site or proxy asks for a username and password (HTTP authentication). */
function AuthPrompt({ state }: { state: Parameters<typeof Sidebar>[0]['state'] }) {
  const auth = state.auth!
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const user = useRef<HTMLInputElement>(null)
  useEffect(() => user.current?.focus(), [])
  const cancel = () => dispatch({ type: 'auth.cancel' })
  return (
    <div className="overlay-backdrop">
      <form
        className="auth-prompt"
        onSubmit={(e) => {
          e.preventDefault()
          dispatch({ type: 'auth.submit', username, password })
        }}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
      >
        <h2>Sign in</h2>
        <p>
          {auth.isProxy ? 'The proxy ' : ''}
          <b>{auth.host}</b> requires a username and password.{auth.realm ? ` (${auth.realm})` : ''}
        </p>
        <input ref={user} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="off" spellCheck={false} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="off" />
        <div className="auth-actions">
          <button type="button" className="lib-button" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="lib-button primary">
            Sign In
          </button>
        </div>
      </form>
    </div>
  )
}
