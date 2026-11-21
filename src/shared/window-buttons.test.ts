import { describe, expect, it } from 'vitest'
import { WINDOW_BUTTONS, windowButtons } from './window-buttons'

describe('window buttons', () => {
  it('show in the sidebar', () => {
    expect(windowButtons({ sidebarVisible: true, hoverSidebar: false, fullscreen: false })).toEqual({ visible: true, position: WINDOW_BUTTONS })
  })

  it('hide with the sidebar, and come back inside the hover panel', () => {
    expect(windowButtons({ sidebarVisible: false, hoverSidebar: false, fullscreen: false }).visible).toBe(false)
    const hover = windowButtons({ sidebarVisible: false, hoverSidebar: true, fullscreen: false })
    expect(hover.visible).toBe(true)
    expect(hover.position.x).toBeGreaterThan(WINDOW_BUTTONS.x)
    expect(hover.position.y).toBeGreaterThan(WINDOW_BUTTONS.y)
  })

  it('always show in full screen, at their normal place, even with the sidebar hidden', () => {
    for (const sidebarVisible of [true, false]) {
      for (const hoverSidebar of [true, false]) {
        expect(windowButtons({ sidebarVisible, hoverSidebar, fullscreen: true })).toEqual({ visible: true, position: WINDOW_BUTTONS })
      }
    }
  })
})
