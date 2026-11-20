import { useEffect, useRef } from 'react'
import { themeStyle } from './App'
import { Sidebar } from './Sidebar'
import { CommandBar } from './CommandBar'
import { Library } from './Library'
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
      {state.splitDragging ? (
        <SplitDragSurface state={state} />
      ) : state.commandBar ? (
        <CommandBar state={state} />
      ) : state.library ? (
        <Library state={state} />
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
