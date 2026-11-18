/// <reference lib="dom" />
// Runs in every web page when "Prefer H.264 video" is on.
//
// Intel Macs decode H.264 in hardware but VP9/AV1 in software, so a YouTube
// video can use several CPU cores and heat up the machine. Claiming not to
// support VP9/AV1 makes YouTube (and most other players) fall back to H.264.
// Same idea as the h264ify extension. Downside: YouTube caps H.264 at 1080p.
import { contextBridge } from 'electron'

contextBridge.executeInMainWorld({
  func: () => {
    const blocked = /\b(vp0?9|av01|av1)\b/i
    const isBlocked = (type: unknown) => typeof type === 'string' && blocked.test(type)

    const ms = (window as { MediaSource?: typeof MediaSource }).MediaSource
    if (ms) {
      const orig = ms.isTypeSupported.bind(ms)
      ms.isTypeSupported = (type: string) => !isBlocked(type) && orig(type)
    }

    const canPlay = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function (type: string) {
      return isBlocked(type) ? '' : canPlay.call(this, type)
    }

    const mc = navigator.mediaCapabilities
    if (mc?.decodingInfo) {
      const decodingInfo = mc.decodingInfo.bind(mc)
      mc.decodingInfo = (config: MediaDecodingConfiguration) =>
        isBlocked(config.video?.contentType)
          ? Promise.resolve({ supported: false, smooth: false, powerEfficient: false } as MediaCapabilitiesDecodingInfo)
          : decodingInfo(config)
    }
  },
})
