/** Width of the sidebar in px. The UI and the main-process layout must agree. */
export const SIDEBAR_WIDTH = 248
/** Gap between the window edge and the rounded web view. */
export const VIEW_GAP = 8
export const VIEW_RADIUS = 10

/**
 * The frame around the page: a gap with rounded corners in a normal window,
 * nothing in full screen, where the page should reach the edges of the display.
 */
export function pageFrame(fullscreen: boolean): { gap: number; radius: number } {
  return fullscreen ? { gap: 0, radius: 0 } : { gap: VIEW_GAP, radius: VIEW_RADIUS }
}
/** Height of the strip at the top of the sidebar that holds the window buttons and drags the window. */
export const SIDEBAR_TOP_HEIGHT = 44

/** Arc-like space colors. */
export const SPACE_COLORS = [
  { name: 'Purple', value: '#7c6cf2' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Gray', value: '#64748b' },
]
