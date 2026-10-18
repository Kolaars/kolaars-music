import { useEffect, useState, type JSX } from 'react'
import { Icon, type IconName } from './Icon'

export interface CoverProps {
  src?: string | null
  alt: string
  className?: string
  /** Fallback glyph when there is no artwork. */
  icon?: IconName
  rounded?: 'sm' | 'md' | 'lg' | 'full'
}

/**
 * Album artwork with a graceful fallback.
 *
 * Archive.org thumbnails sometimes 404 or are not really images, so a failed
 * load degrades to a branded placeholder instead of a broken-image glyph.
 */
export function Cover({ src, alt, className, icon = 'music', rounded = 'md' }: CoverProps): JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const classes = ['cover', `cover--${rounded}`, className].filter(Boolean).join(' ')

  if (!src || failed) {
    return (
      <div className={`${classes} cover--placeholder`} role="img" aria-label={alt} title={alt}>
        <Icon name={icon} size={22} />
      </div>
    )
  }

  return (
    <div className={classes}>
      <img src={src} alt={alt} loading="lazy" draggable={false} onError={() => setFailed(true)} />
    </div>
  )
}
