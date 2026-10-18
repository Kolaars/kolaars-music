import type { JSX } from 'react'
import { Icon, type IconName } from './Icon'

export interface EmptyStateProps {
  icon?: IconName
  title: string
  text?: string
  action?: { label: string; onClick: () => void; icon?: IconName }
  compact?: boolean
}

export function EmptyState({ icon = 'music', title, text, action, compact }: EmptyStateProps): JSX.Element {
  return (
    <div className={`empty${compact ? ' empty--compact' : ''}`}>
      <div className="empty__icon">
        <Icon name={icon} size={compact ? 22 : 30} />
      </div>
      <h3 className="empty__title">{title}</h3>
      {text ? <p className="empty__text">{text}</p> : null}
      {action ? (
        <button type="button" className="btn btn--primary" onClick={action.onClick}>
          {action.icon ? <Icon name={action.icon} size={16} /> : null}
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/** Shimmering placeholder used while catalog shelves load. */
export function Skeleton({
  width,
  height,
  radius = 8,
  className
}: {
  width?: number | string
  height?: number | string
  radius?: number
  className?: string
}): JSX.Element {
  return (
    <div
      className={`skeleton${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius }}
    />
  )
}

export function ShelfSkeleton({ cards = 5 }: { cards?: number }): JSX.Element {
  return (
    <section className="shelf">
      <div className="shelf__head">
        <Skeleton width={220} height={20} />
      </div>
      <div className="shelf__row">
        {Array.from({ length: cards }, (_, index) => (
          <div className="card" key={index}>
            <Skeleton className="card__art" radius={14} />
            <Skeleton width="75%" height={13} />
            <Skeleton width="50%" height={11} />
          </div>
        ))}
      </div>
    </section>
  )
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }): JSX.Element {
  return (
    <div className="tracklist">
      {Array.from({ length: rows }, (_, index) => (
        <div className="trackrow trackrow--skeleton" key={index}>
          <Skeleton width={22} height={14} />
          <Skeleton width={36} height={36} radius={8} />
          <Skeleton width="40%" height={13} />
          <Skeleton width="22%" height={12} />
        </div>
      ))}
    </div>
  )
}
