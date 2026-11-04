/**
 * A small, persistent notice that appears when a release is available,
 * downloading, or ready to install. It is deliberately not a toast: an update
 * should stay visible until the user acts on it or dismisses it.
 */

import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { useApp } from '../state/store'
import { useUpdates } from '../state/updates'
import { formatBytes } from '../lib/format'
import { t } from '../lib/i18n'

/** Versions already announced by a desktop notification in this process. */
const notified = new Set<string>()

export function UpdateBanner(): JSX.Element | null {
  const platform = useApp((state) => state.appInfo?.platform)
  const notifications = useApp((state) => state.settings.notifications)
  const update = useUpdates((state) => state.update)
  const download = useUpdates((state) => state.download)
  const install = useUpdates((state) => state.install)
  const openRelease = useUpdates((state) => state.openRelease)

  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  useEffect(() => {
    void useUpdates.getState().init()
  }, [])

  const availableVersion = update.status === 'available' ? update.version : undefined

  useEffect(() => {
    if (!availableVersion || !notifications) return
    if (notified.has(availableVersion)) return
    notified.add(availableVersion)
    // The banner is enough when the window is in front. A notification is for
    // the case where the check finished while the user was doing something else.
    if (document.hasFocus()) return
    if (typeof Notification === 'undefined') return
    try {
      new Notification(t('Доступно обновление Kolaars Music'), {
        body: t('Версия {0} уже опубликована на GitHub.', { 0: availableVersion }),
        silent: true
      })
    } catch {
      /* notifications are optional */
    }
  }, [availableVersion, notifications])

  if (platform === 'android') return null
  if (dismissedVersion && dismissedVersion === update.version) return null
  if (update.status !== 'available' && update.status !== 'downloading' && update.status !== 'ready') {
    return null
  }

  const version = update.version ?? ''
  const percent = update.progress?.percent ?? 0
  const canInstall = update.canInstall

  const title =
    update.status === 'downloading'
      ? t('Загружаем обновление {0}', { 0: version })
      : update.status === 'ready'
        ? t('Обновление {0} готово', { 0: version })
        : t('Доступна версия {0}', { 0: version })

  const text =
    update.status === 'downloading'
      ? t('{0}% · {1} из {2}', {
          0: percent,
          1: formatBytes(update.progress?.transferred),
          2: formatBytes(update.progress?.total)
        })
      : update.status === 'ready'
        ? t('Перезапустите приложение, чтобы установить новую версию.')
        : canInstall
          ? t('Скачайте обновление — приложение установит его и перезапустится.')
          : update.installReason === 'portable'
            ? t('Портативная версия не обновляется сама: скачайте новый файл со страницы релиза.')
            : t('Скачайте новую версию со страницы релиза.')

  const action = ((): { label: string; run: () => void } | null => {
    if (update.status === 'downloading') return null
    if (update.status === 'ready') {
      return { label: t('Перезапустить и обновить'), run: () => void install() }
    }
    if (canInstall) {
      return { label: t('Скачать'), run: () => void download() }
    }
    return { label: t('Страница релиза'), run: () => void openRelease() }
  })()

  return (
    <div className="updatebar" role="status">
      <span className="updatebar__icon">
        <Icon name={update.status === 'ready' ? 'sparkles' : 'download'} size={18} />
      </span>

      <div className="updatebar__main">
        <div className="updatebar__title">{title}</div>
        <div className="updatebar__text">{text}</div>
        {update.status === 'downloading' ? (
          <div className="updatebar__progress" aria-hidden="true">
            <span style={{ width: `${Math.max(2, percent)}%` }} />
          </div>
        ) : null}
      </div>

      {action ? (
        <button type="button" className="btn btn--primary btn--sm" onClick={action.run}>
          {action.label}
        </button>
      ) : null}

      {update.status === 'available' ? (
        <button
          type="button"
          className="iconbtn iconbtn--sm updatebar__close"
          title={t('Скрыть уведомление об обновлении')}
          onClick={() => setDismissedVersion(version)}
        >
          ×
        </button>
      ) : null}

      {update.status === 'available' ? (
        <button type="button" className="linklike updatebar__details" onClick={() => setRouteToSettings()}>
          {t('Подробнее')}
        </button>
      ) : null}
    </div>
  )
}

/** Opens Settings where the full update state and the auto-check switch live. */
function setRouteToSettings(): void {
  useApp.getState().setRoute({ name: 'settings' })
}
