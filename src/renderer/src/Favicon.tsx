import { useState } from 'react'
import { displayHost } from '../../shared/url'

export function Favicon({ src, url, loading }: { src?: string; url: string; loading?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (loading) return <span className="favicon spinner" aria-label="Loading" />
  if (src && failed !== src) {
    return <img className="favicon" src={src} alt="" draggable={false} onError={() => setFailed(src)} />
  }
  const letter = displayHost(url).replace(/^[^a-z0-9]+/i, '').charAt(0).toUpperCase() || '•'
  return <span className="favicon letter">{letter}</span>
}
