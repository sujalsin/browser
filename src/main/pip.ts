import type { WebContents } from 'electron'

// Picture-in-picture: pop the page's video out into a small floating window.

/** Picks the video worth popping out: one that is playing, the largest if several. */
const PICK = `
  const videos = [...document.querySelectorAll('video')].filter((v) => v.readyState >= 2 && v.videoWidth > 0)
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height }
  const playing = videos.filter((v) => !v.paused && !v.ended)
  const video = (playing.length ? playing : videos).sort((a, b) => area(b) - area(a))[0]
`

const script = (mode: 'enter' | 'exit' | 'toggle', force: boolean) => `(async () => {
  try {
    if (document.pictureInPictureElement) {
      if (${mode === 'enter'}) return 'ok'
      await document.exitPictureInPicture()
      return 'exited'
    }
    if (${mode === 'exit'}) return 'none'
    ${PICK}
    if (!video) return 'none'
    // Some sites switch the feature off; a direct request from you overrides that.
    if (video.disablePictureInPicture) { if (!${force}) return 'none'; video.disablePictureInPicture = false }
    await video.requestPictureInPicture()
    return 'ok'
  } catch (err) {
    return 'error'
  }
})()`

/**
 * Enter, exit or toggle picture-in-picture for a tab. The video may be inside
 * an embedded frame (most players are), so every frame is tried.
 * `force` (a direct request, not the automatic one) overrides sites that disable it.
 */
export async function pictureInPicture(wc: WebContents, mode: 'enter' | 'exit' | 'toggle', force = false): Promise<'ok' | 'exited' | 'none'> {
  if (wc.isDestroyed()) return 'none'
  const code = script(mode, force)
  for (const frame of wc.mainFrame.framesInSubtree) {
    // `true`: counts as a user action, which browsers require for picture-in-picture.
    const result = await frame.executeJavaScript(code, true).catch(() => 'error')
    if (result === 'ok' || result === 'exited') return result
  }
  return 'none'
}
