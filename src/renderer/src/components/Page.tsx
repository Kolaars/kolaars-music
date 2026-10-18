/** Page shell + header shared by every routed view. */

import type { JSX, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Page({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`page${className ? ` ${className}` : ''}`}>{children}</div>
}

export function PageHeader({
  icon,
  title,
  subtitle,
  actions
}: {
  icon?: IconName
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}): JSX.Element {
  return (
    <header className="page__head">
      <div className="page__headtext">
        <h1 className="page__title">
          {icon ? <Icon name={icon} size={19} /> : null}
          <span>{title}</span>
        </h1>
        {subtitle ? <p className="page__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page__actions">{actions}</div> : null}
    </header>
  )
}
