/** Transient notifications, stacked bottom-right above the player bar. */

import type { JSX } from 'react'
import { useApp } from '../state/store'
import { Icon, type IconName } from './Icon'

const ICONS: Record<string, IconName> = {
  info: 'info',
  success: 'check',
  error: 'alert'
}

export function Toasts(): JSX.Element | null {
  const toasts = useApp((state) => state.toasts)
  const dismiss = useApp((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast__icon">
            <Icon name={ICONS[toast.kind] ?? 'info'} size={16} />
          </span>
          <span className="toast__text">{toast.message}</span>
          <button
            type="button"
            className="iconbtn iconbtn--sm toast__close"
            title="Скрыть"
            onClick={() => dismiss(toast.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
