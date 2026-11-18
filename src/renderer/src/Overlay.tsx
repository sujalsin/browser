import { useEffect, useRef } from 'react'
import { Sidebar, themeStyle } from './App'
import { CommandBar } from './CommandBar'
import { dispatch, useBrowserState } from './useBrowserState'

/**
 * Content of the transparent overlay view that sits above web pages:
 * the command bar, or the sidebar peeking in while it is hidden.
 */
export function Overlay() {
  const state = useBrowserState()
  if (!state) return null
  return (
    <div className={`overlay-root ${state.platform}`} style={themeStyle(state)}>
      {state.commandBar ? <CommandBar state={state} /> : state.peek ? <PeekSidebar state={state} /> : null}
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
