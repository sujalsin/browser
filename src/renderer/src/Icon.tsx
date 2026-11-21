// Small inline stroke icons so the UI has no icon-font dependency.

const PATHS = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  reload: 'M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  minus: 'M6 12h12',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6',
  muted: 'M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9M12 3C9.5 5.5 8.5 8.5 8.5 12s1 6.5 3.5 9',
  tab: 'M4 6h16v12H4zM4 10h16',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  folderPlus: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5zM12 11v6M9 14h6',
  chevron: 'M9 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  tidy: 'M4 6h16M4 12h10M4 18h6',
  up: 'M6 15l6-6 6 6',
  split: 'M4 5h16v14H4zM12 5v14',
  tasks: 'M4 19V9M10 19V5M16 19v-7M21 19H3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  zap: 'M13 3L4 14h7l-1 7 9-11h-7z',
  boost: 'M12 2l2.4 6.6L21 9l-5 4.4L17.5 21 12 17.3 6.5 21 8 13.4 3 9l6.6-.4z',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1-.8-1.3-.8-2.2 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 12a1 1 0 1 0 0-.01M10 7.5a1 1 0 1 0 0-.01M15 7.5a1 1 0 1 0 0-.01',
  down: 'M6 9l6 6 6-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  folderOpen: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3zM3 10h18l-2 9H5z',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7z',
  import: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  shieldOff: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM4 4l16 16',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
