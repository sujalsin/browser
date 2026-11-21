import type { WebPreferences } from 'electron'

/**
 * Settings every web page runs with, wherever it is shown (tab, Peek, Little
 * Arc, a site's popup window).
 *
 * Pages are sandboxed and get no Node.js access. `nodeIntegrationInSubFrames`
 * does not change that: with the sandbox on, all it does is run our page-start
 * scripts (Shields' scriptlets, the H.264 preference) in embedded frames as
 * well, so a video player embedded in another site is treated like the site
 * itself.
 */
export function pagePreferences(partition: string): WebPreferences {
  return { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true }
}
