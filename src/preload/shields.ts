/// <reference lib="dom" />
// Shields, the part inside the page. Runs before any of the page's own scripts.
//
// Filter lists run small scripts ("scriptlets") inside some pages. Many only
// work if they get there first: YouTube's, for one, must be in place before the
// page reads its ad schedule, or the player sits waiting for ads that Shields
// then block.
//
// - A page itself asks for its scriptlets and waits for the answer (a lookup,
//   well under a millisecond), so they are in place before its first script.
// - A frame inside a page asks without waiting. Pages can hold dozens of
//   frames, and making each one wait on the browser's main process holds up the
//   whole page on a slow machine. Its scriptlets arrive a moment after it
//   starts, which is soon enough for what frames are used for (an embedded
//   video player asks for its ads when you press play).
import { ipcRenderer, webFrame } from 'electron'
import { SCRIPTLETS_CHANNEL, SCRIPTLETS_LATER_CHANNEL } from '../shared/scriptlets'

const isTopPage = window === window.top

if (location.protocol === 'https:' || location.protocol === 'http:') {
  try {
    if (isTopPage) {
      const code = ipcRenderer.sendSync(SCRIPTLETS_CHANNEL, location.href) as string
      // Into the page's own JavaScript world, right now.
      if (code) void webFrame.executeJavaScript(code)
    } else {
      void ipcRenderer
        .invoke(SCRIPTLETS_LATER_CHANNEL, location.href)
        .then((code: string) => code && webFrame.executeJavaScript(code))
        .catch(() => {})
    }
  } catch {
    // Without scriptlets the page still loads; network blocking is unaffected.
  }
}

// Hiding ad elements (the filter engine's own in-page script). It only does
// anything in the page itself, so frames don't load it at all.
if (isTopPage) require('@ghostery/adblocker-electron-preload')
