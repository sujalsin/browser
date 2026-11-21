import { SIDEBAR_TOP_HEIGHT, VIEW_GAP } from './constants'

// The macOS window buttons (close, minimise, full screen) live in the sidebar.

/** Their home: centered in the strip at the top of the sidebar. The buttons are 12px tall. */
export const WINDOW_BUTTONS = { x: 16, y: Math.round(SIDEBAR_TOP_HEIGHT / 2) - 6 }

/** Should the window buttons show right now, and where? */
export function windowButtons(s: { sidebarVisible: boolean; hoverSidebar: boolean; fullscreen: boolean }): {
  visible: boolean
  position: { x: number; y: number }
} {
  // In full screen macOS keeps them in the bar that drops down from the top of
  // the screen. They must stay there whatever the sidebar is doing: hidden, there
  // would be no button to leave full screen with.
  if (s.fullscreen) return { visible: true, position: WINDOW_BUTTONS }
  // Sidebar hidden: nothing to sit in until it slides in over the page. That
  // panel floats a little in from the window's corner, so they move in with it.
  if (!s.sidebarVisible) {
    return { visible: s.hoverSidebar, position: { x: WINDOW_BUTTONS.x + VIEW_GAP, y: WINDOW_BUTTONS.y + VIEW_GAP } }
  }
  return { visible: true, position: WINDOW_BUTTONS }
}
