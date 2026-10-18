/**
 * Inline SVG icon set.
 *
 * Bundling the icons (instead of pulling in an icon package) keeps the app
 * dependency-light and lets every glyph inherit `currentColor` and the app's
 * stroke weight.
 */

import type { JSX } from 'react'

export type IconName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'next'
  | 'previous'
  | 'shuffle'
  | 'repeat'
  | 'repeat-one'
  | 'volume-high'
  | 'volume-low'
  | 'volume-mute'
  | 'heart'
  | 'heart-filled'
  | 'search'
  | 'compass'
  | 'library'
  | 'queue'
  | 'download'
  | 'settings'
  | 'plus'
  | 'trash'
  | 'pencil'
  | 'clock'
  | 'lyrics'
  | 'mic'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'external'
  | 'more'
  | 'check'
  | 'grip'
  | 'refresh'
  | 'alert'
  | 'info'
  | 'music'
  | 'disc'
  | 'sparkles'
  | 'folder'
  | 'upload'
  | 'link'
  | 'offline'
  | 'grid'
  | 'equalizer'
  | 'book'
  | 'shield'
  | 'bolt'
  | 'globe'
  | 'trash-off'

export interface IconProps {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}

const FILLED = new Set<IconName>(['play', 'pause', 'stop', 'next', 'previous', 'more', 'heart-filled', 'bolt'])

function paths(name: IconName): JSX.Element {
  switch (name) {
    case 'play':
      return <path d="M7 4.5 19.5 12 7 19.5z" />
    case 'pause':
      return (
        <>
          <rect x="6.5" y="5" width="3.6" height="14" rx="1.4" />
          <rect x="13.9" y="5" width="3.6" height="14" rx="1.4" />
        </>
      )
    case 'stop':
      return <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" />
    case 'next':
      return (
        <>
          <path d="M5.5 5 15 12l-9.5 7z" />
          <rect x="16.6" y="5" width="2.6" height="14" rx="1.3" />
        </>
      )
    case 'previous':
      return (
        <>
          <path d="M18.5 5 9 12l9.5 7z" />
          <rect x="4.8" y="5" width="2.6" height="14" rx="1.3" />
        </>
      )
    case 'shuffle':
      return (
        <>
          <path d="M17 3.5h4v4" />
          <path d="M3.5 20.5 21 3" />
          <path d="M21 16.5v4h-4" />
          <path d="M15.5 15.5 21 21" />
          <path d="M3.5 3.5 8 8" />
        </>
      )
    case 'repeat':
      return (
        <>
          <path d="M17 2.5l3.5 3.5L17 9.5" />
          <path d="M3.5 11.5v-1.5A4 4 0 0 1 7.5 6h13" />
          <path d="M7 21.5 3.5 18 7 14.5" />
          <path d="M20.5 12.5v1.5a4 4 0 0 1-4 4h-13" />
        </>
      )
    case 'repeat-one':
      return (
        <>
          <path d="M17 2.5l3.5 3.5L17 9.5" />
          <path d="M3.5 11.5v-1.5A4 4 0 0 1 7.5 6h13" />
          <path d="M7 21.5 3.5 18 7 14.5" />
          <path d="M20.5 12.5v1.5a4 4 0 0 1-4 4h-13" />
          <path d="M11.5 10.5h1.2v4" />
        </>
      )
    case 'volume-high':
      return (
        <>
          <path d="M11 4.8 6.2 9H2.5v6h3.7L11 19.2z" />
          <path d="M15.6 8.6a4.8 4.8 0 0 1 0 6.8" />
          <path d="M18.8 5.4a9.4 9.4 0 0 1 0 13.2" />
        </>
      )
    case 'volume-low':
      return (
        <>
          <path d="M11 4.8 6.2 9H2.5v6h3.7L11 19.2z" />
          <path d="M15.6 8.6a4.8 4.8 0 0 1 0 6.8" />
        </>
      )
    case 'volume-mute':
      return (
        <>
          <path d="M11 4.8 6.2 9H2.5v6h3.7L11 19.2z" />
          <path d="m15.5 9.5 5 5" />
          <path d="m20.5 9.5-5 5" />
        </>
      )
    case 'heart':
      return (
        <path d="M12 20.3 4.7 13.2A5 5 0 0 1 12 6.4a5 5 0 0 1 7.3 6.8z" />
      )
    case 'heart-filled':
      return (
        <path d="M12 20.6 4.4 13.1A5.2 5.2 0 0 1 12 6.1a5.2 5.2 0 0 1 7.6 7z" />
      )
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="6.6" />
          <path d="m20.5 20.5-4.6-4.6" />
        </>
      )
    case 'compass':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4z" />
        </>
      )
    case 'library':
      return (
        <>
          <path d="M21 14.5V5.5" />
          <circle cx="18.5" cy="16" r="2.5" />
          <path d="M12 12H3" />
          <path d="M16 6H3" />
          <path d="M12 18H3" />
        </>
      )
    case 'queue':
      return (
        <>
          <path d="M8.5 6H21" />
          <path d="M8.5 12H21" />
          <path d="M8.5 18H21" />
          <path d="M3.6 6h.01" />
          <path d="M3.6 12h.01" />
          <path d="M3.6 18h.01" />
        </>
      )
    case 'download':
      return (
        <>
          <path d="M20.5 15.5v3.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3.5" />
          <path d="m7.5 11 4.5 4.5L16.5 11" />
          <path d="M12 15.5V3" />
        </>
      )
    case 'settings':
      return (
        <>
          <path d="M3.5 6.5h9" />
          <path d="M17.5 6.5h3" />
          <circle cx="15" cy="6.5" r="2.2" />
          <path d="M3.5 12h3" />
          <path d="M11.5 12h9" />
          <circle cx="9" cy="12" r="2.2" />
          <path d="M3.5 17.5h9" />
          <path d="M17.5 17.5h3" />
          <circle cx="15" cy="17.5" r="2.2" />
        </>
      )
    case 'plus':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      )
    case 'trash':
      return (
        <>
          <path d="M3.5 6.5h17" />
          <path d="M18.5 6.5v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13" />
          <path d="M8.5 6.5V4.6a1.6 1.6 0 0 1 1.6-1.6h3.8a1.6 1.6 0 0 1 1.6 1.6v1.9" />
        </>
      )
    case 'trash-off':
      return (
        <>
          <path d="M3.5 6.5h9" />
          <path d="M18.5 6.5v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9" />
          <path d="m3 3 18 18" />
        </>
      )
    case 'pencil':
      return (
        <>
          <path d="M12.5 20.5H21" />
          <path d="M16.6 3.7a2.1 2.1 0 0 1 3 3L7.3 19l-4.3 1.2L4.2 16z" />
        </>
      )
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.4l3.4 2" />
        </>
      )
    case 'lyrics':
      return (
        <>
          <path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7.5z" />
          <path d="M14.5 2.5v5h5" />
          <path d="M8.5 13h7" />
          <path d="M8.5 17h4.5" />
        </>
      )
    case 'mic':
      return (
        <>
          <path d="M12 2.5a3 3 0 0 0-3 3v6.5a3 3 0 0 0 6 0V5.5a3 3 0 0 0-3-3Z" />
          <path d="M19 11.5v.5a7 7 0 0 1-14 0v-.5" />
          <path d="M12 19.5v2.5" />
        </>
      )
    case 'close':
      return (
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      )
    case 'minimize':
      return <path d="M5 12h14" />
    case 'maximize':
      return <rect x="5" y="5" width="14" height="14" rx="2.4" />
    case 'restore':
      return (
        <>
          <rect x="4" y="8" width="12" height="12" rx="2" />
          <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
        </>
      )
    case 'chevron-left':
      return <path d="M15 5.5 8.5 12l6.5 6.5" />
    case 'chevron-right':
      return <path d="m9 5.5 6.5 6.5L9 18.5" />
    case 'chevron-down':
      return <path d="M5.5 9 12 15.5 18.5 9" />
    case 'chevron-up':
      return <path d="M5.5 15 12 8.5 18.5 15" />
    case 'external':
      return (
        <>
          <path d="M14.5 3.5H20.5v6" />
          <path d="M10.5 13.5 20.5 3.5" />
          <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
        </>
      )
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </>
      )
    case 'check':
      return <path d="m5 12.5 4.5 4.5L19 7" />
    case 'grip':
      return (
        <>
          <circle cx="9" cy="6" r="1.3" />
          <circle cx="15" cy="6" r="1.3" />
          <circle cx="9" cy="12" r="1.3" />
          <circle cx="15" cy="12" r="1.3" />
          <circle cx="9" cy="18" r="1.3" />
          <circle cx="15" cy="18" r="1.3" />
        </>
      )
    case 'refresh':
      return (
        <>
          <path d="M20.5 12a8.5 8.5 0 1 1-2.7-6.2" />
          <path d="M20.5 3.5v5h-5" />
        </>
      )
    case 'alert':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5" />
          <path d="M12 16.5h.01" />
        </>
      )
    case 'info':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16.5V11" />
          <path d="M12 7.5h.01" />
        </>
      )
    case 'music':
      return (
        <>
          <circle cx="7" cy="18" r="2.8" />
          <circle cx="18" cy="15.5" r="2.8" />
          <path d="M9.8 18V6.2l11-2.2v11.5" />
        </>
      )
    case 'disc':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      )
    case 'sparkles':
      return (
        <>
          <path d="m11.5 3.5 1.8 4.7 4.7 1.8-4.7 1.8-1.8 4.7-1.8-4.7-4.7-1.8 4.7-1.8z" />
          <path d="m18.5 15 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
        </>
      )
    case 'folder':
      return (
        <path d="M3.5 19.5h17a1.5 1.5 0 0 0 1.5-1.5V8.5A1.5 1.5 0 0 0 20.5 7h-7.2a1.5 1.5 0 0 1-1.27-.7l-.86-1.4a1.5 1.5 0 0 0-1.27-.7H3.5A1.5 1.5 0 0 0 2 5.7v12.3a1.5 1.5 0 0 0 1.5 1.5Z" />
      )
    case 'upload':
      return (
        <>
          <path d="M20.5 15.5v3.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3.5" />
          <path d="M16.5 8 12 3.5 7.5 8" />
          <path d="M12 3.5v12" />
        </>
      )
    case 'link':
      return (
        <>
          <path d="M9.8 13.6a4.6 4.6 0 0 0 6.9.5l2.6-2.6a4.6 4.6 0 0 0-6.5-6.5L11.4 6.4" />
          <path d="M14.2 10.4a4.6 4.6 0 0 0-6.9-.5l-2.6 2.6a4.6 4.6 0 0 0 6.5 6.5l1.4-1.4" />
        </>
      )
    case 'offline':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m5.6 5.6 12.8 12.8" />
        </>
      )
    case 'grid':
      return (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
        </>
      )
    case 'equalizer':
      return (
        <>
          <path d="M5 19V9" />
          <path d="M10 19V5" />
          <path d="M15 19v-6" />
          <path d="M20 19v-9" />
        </>
      )
    case 'book':
      return (
        <>
          <path d="M4.5 19.2A2.7 2.7 0 0 1 7.2 16.5H20" />
          <path d="M7.2 2.5H20v19H7.2a2.7 2.7 0 0 1-2.7-2.7V5.2A2.7 2.7 0 0 1 7.2 2.5Z" />
        </>
      )
    case 'shield':
      return (
        <>
          <path d="M12 21.5s7.5-3.7 7.5-9.3V5.6L12 2.5 4.5 5.6v6.6c0 5.6 7.5 9.3 7.5 9.3Z" />
          <path d="m9 12 2.2 2.2L15.4 10" />
        </>
      )
    case 'bolt':
      return <path d="M13.5 2.5 5 13.5h5.5L9.5 21.5 19 10.2h-5.7z" />
    case 'globe':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18Z" />
        </>
      )
    default:
      return <circle cx="12" cy="12" r="9" />
  }
}

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: IconProps): JSX.Element {
  const filled = FILLED.has(name)
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths(name)}
    </svg>
  )
}
