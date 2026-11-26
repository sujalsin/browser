import { memo, useEffect, useState, type CSSProperties } from 'react'
import { SPACE_COLORS } from '../../shared/constants'
import { displayHost } from '../../shared/url'

/** A steady color for a site that has no icon: the same site always gets the same one. */
function tileColor(host: string): string {
  let hash = 0
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0
  return SPACE_COLORS[Math.abs(hash) % SPACE_COLORS.length].value
}

// An icon that fails to download (offline for a moment, the site hiccups) is
// tried again a few times, further apart each time, before settling on the letter.
const RETRY_AFTER_MS = [4_000, 30_000, 180_000]
/** How many times each icon address has failed. Emptied again when it loads. */
const failures = new Map<string, number>()

export const Favicon = memo(function Favicon({ src, url, loading }: { src?: string; url: string; loading?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = !!src && failedSrc === src
  useEffect(() => {
    if (!failed) return
    const wait = RETRY_AFTER_MS[(failures.get(src!) ?? 1) - 1]
    if (wait === undefined) return // given up
    const timer = setTimeout(() => setFailedSrc(null), wait)
    return () => clearTimeout(timer)
  }, [failed, src])
  if (loading) return <span className="favicon spinner" aria-label="Loading" />
  if (src && !failed) {
    return (
      <img
        className="favicon"
        src={src}
        alt=""
        draggable={false}
        onLoad={() => failures.delete(src)}
        onError={() => {
          failures.set(src, (failures.get(src) ?? 0) + 1)
          setFailedSrc(src)
        }}
      />
    )
  }
  const host = displayHost(url)
  const letter = host.replace(/^[^a-z0-9]+/i, '').charAt(0).toUpperCase() || '•'
  return (
    <span className="favicon letter" style={{ '--tile': tileColor(host) } as CSSProperties}>
      {letter}
    </span>
  )
})
