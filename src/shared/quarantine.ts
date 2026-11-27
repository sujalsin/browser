/**
 * macOS checks an app, installer or script the first time it is opened
 * (Gatekeeper: "downloaded from the internet, are you sure?", plus Apple's
 * malware check) only if the file carries the `com.apple.quarantine` mark.
 * Browsers put that mark on everything they download; this is its value.
 *
 *   flags ; time of download (hex seconds) ; app that downloaded it ; id
 *
 * 0081 is what Chrome writes: "downloaded, not yet approved by the user".
 */
export function quarantineValue(nowMs: number, uuid: string, agent = 'Browser'): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000)).toString(16)
  const name = agent.replace(/[^A-Za-z0-9 ._-]/g, '') || 'Browser'
  const id = /^[0-9a-fA-F-]{36}$/.test(uuid) ? uuid.toUpperCase() : '00000000-0000-0000-0000-000000000000'
  return `0081;${seconds};${name};${id}`
}

export const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine'
