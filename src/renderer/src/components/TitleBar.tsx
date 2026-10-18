/**
 * Frameless window chrome.
 *
 * The whole strip is a drag region except the interactive parts, which are
 * marked `no-drag` in CSS. Maximise state comes from the main process so the
 * button icon stays correct when the user resizes or snap-drags the window.
 */

import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { Icon } from './Icon'

export interface TitleBarProps {
  title: string
  subtitle?: string
  canGoBack: boolean
  onBack: () => void
}

export function TitleBar({ title, subtitle, canGoBack, onBack }: TitleBarProps): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const unsubscribe = api.app.onWindowState((state) => setMaximized(state.maximized))
    return unsubscribe
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar__drag">
        <button
          type="button"
          className="iconbtn iconbtn--sm titlebar__back"
          disabled={!canGoBack}
          title="Назад"
          onClick={onBack}
        >
          <Icon name="chevron-left" size={16} />
        </button>

        <div className="titlebar__titles">
          <span className="titlebar__title">{title}</span>
          {subtitle ? <span className="titlebar__subtitle">{subtitle}</span> : null}
        </div>
      </div>

      <div className="titlebar__window">
        <button
          type="button"
          className="winbtn"
          title="Свернуть"
          onClick={() => void api.app.minimize()}
        >
          <Icon name="minimize" size={16} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="winbtn"
          title={maximized ? 'Восстановить' : 'Развернуть'}
          onClick={() => void api.app.toggleMaximize()}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={15} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="winbtn winbtn--close"
          title="Закрыть"
          onClick={() => void api.app.close()}
        >
          <Icon name="close" size={16} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  )
}
