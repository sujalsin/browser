import { memo, useState, type CSSProperties } from 'react'
import { SPACE_COLORS } from '../../shared/constants'
import { displayHost } from '../../shared/url'

/** A steady color for a site that has no icon: the same site always gets the same one. */
function tileColor(host: string): string {
  let hash = 0
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0
  return SPACE_COLORS[Math.abs(hash) % SPACE_COLORS.length].value
}

export const Favicon = memo(function Favicon({ src, url, loading }: { src?: string; url: string; loading?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (loading) return <span className="favicon spinner" aria-label="Loading" />
  if (src && failed !== src) {
    return <img className="favicon" src={src} alt="" draggable={false} onError={() => setFailed(src)} />
  }
  const host = displayHost(url)
  const letter = host.replace(/^[^a-z0-9]+/i, '').charAt(0).toUpperCase() || '•'
  return (
    <span className="favicon letter" style={{ '--tile': tileColor(host) } as CSSProperties}>
      {letter}
    </span>
  )
})
