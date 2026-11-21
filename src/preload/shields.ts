/// <reference lib="dom" />
// Runs in every web page and frame, before any of the page's own scripts.
//
// Filter lists run small scripts ("scriptlets") inside some pages. Many only
// work if they get there first: YouTube's, for one, must be in place before the
// page reads its ad schedule, or the player sits waiting for ads that Shields
// then block. So this asks for the page's scriptlets and waits for the answer
// (a lookup, well under a millisecond) instead of letting the page carry on.
import { ipcRenderer, webFrame } from 'electron'
import { SCRIPTLETS_CHANNEL } from '../shared/scriptlets'

if (location.protocol === 'https:' || location.protocol === 'http:') {
  try {
    const code = ipcRenderer.sendSync(SCRIPTLETS_CHANNEL, location.href) as string
    // Into the page's own JavaScript world, right now.
    if (code) void webFrame.executeJavaScript(code)
  } catch {
    // Without scriptlets the page still loads; network blocking is unaffected.
  }
}
