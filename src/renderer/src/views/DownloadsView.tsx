/** Offline downloads: live progress, retry, reveal and cleanup. */

import { useEffect, type JSX } from 'react'
import { formatBytes } from '../lib/format'
import { api } from '../lib/api'
import { useApp } from '../state/store'
import { playAll } from '../lib/play'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { EmptyState } from '../components/Feedback'
import { t } from '../lib/i18n'

const STATUS_LABEL: Record<string, string> = {
  queued: 'В очереди',
  downloading: 'Загрузка',
  done: 'Готово',
  error: 'Ошибка',
  cancelled: 'Отменено'
}

export function DownloadsView(): JSX.Element {
  const downloads = useApp((state) => state.downloads)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const refreshDownloads = useApp((state) => state.refreshDownloads)
  const startDownload = useApp((state) => state.startDownload)
  const cancelDownload = useApp((state) => state.cancelDownload)
  const removeDownload = useApp((state) => state.removeDownload)
  const setRoute = useApp((state) => state.setRoute)

  useEffect(() => {
    void refreshDownloads()
  }, [refreshDownloads])

  const active = downloads.filter((record) => record.status === 'downloading' || record.status === 'queued')
  const done = downloads.filter((record) => record.status === 'done')
  const totalBytes = done.reduce((sum, record) => sum + (record.bytesTotal || record.bytesDone || 0), 0)

  return (
    <Page className="page--downloads">
      <PageHeader
        icon="download"
        title={t('Загрузки')}
        subtitle={
          downloads.length === 0
            ? t('Офлайн-копии треков хранятся на диске и играют без интернета')
            : t('{0} готово · {1} в процессе · {2} на диске', { 0: done.length, 1: active.length, 2: formatBytes(totalBytes) })
        }
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshDownloads()}>
            <Icon name="refresh" size={15} />
            {t('Обновить')}</button>
        }
      />

      {downloads.length === 0 ? (
        <EmptyState
          icon="download"
          title={t('Загрузок пока нет')}
          text={t('Откройте меню «…» у любого трека и выберите «Скачать офлайн» — копия появится здесь.')}
          action={{ label: t('Открыть обзор'), icon: 'compass', onClick: () => setRoute({ name: 'discover' }) }}
        />
      ) : (
        <div className="downloads">
          {downloads.map((record) => {
            const track = catalogIndex.get(record.trackId)
            const percent =
              record.bytesTotal > 0 ? Math.min(100, (record.bytesDone / record.bytesTotal) * 100) : 0
            return (
              <div className="download" key={record.trackId}>
                <Cover
                  src={track?.artwork}
                  alt={record.title}
                  rounded="sm"
                  className="download__cover"
                />

                <div className="download__main">
                  <span className="download__title">{record.title}</span>
                  <span className="download__artist">{record.artist}</span>

                  <div className="progress-line">
                    <div
                      className={`progress-line__fill progress-line__fill--${record.status}`}
                      style={{ width: `${record.status === 'done' ? 100 : percent}%` }}
                    />
                  </div>

                  <span className="download__meta">
                    <span className={`badge badge--${record.status}`}>{t(STATUS_LABEL[record.status] ?? record.status)}</span>
                    {record.bytesTotal > 0
                      ? `${formatBytes(record.bytesDone)} / ${formatBytes(record.bytesTotal)}`
                      : formatBytes(record.bytesDone)}
                    {record.error ? ` · ${record.error}` : ''}
                  </span>
                </div>

                <div className="download__actions">
                  {record.status === 'downloading' || record.status === 'queued' ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void cancelDownload(record.trackId)}
                    >
                      <Icon name="close" size={15} />
                      {t('Отменить')}</button>
                  ) : null}

                  {record.status === 'done' ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!track}
                      onClick={() => (track ? playAll([track]) : undefined)}
                    >
                      <Icon name="play" size={15} />
                      {t('Играть')}</button>
                  ) : null}

                  {record.status === 'error' || record.status === 'cancelled' ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!track}
                      onClick={() => (track ? void startDownload(track) : undefined)}
                    >
                      <Icon name="refresh" size={15} />
                      {t('Повторить')}</button>
                  ) : null}

                  {record.status === 'done' ? (
                    <button
                      type="button"
                      className="iconbtn iconbtn--sm"
                      title={t('Показать в папке')}
                      onClick={() => void api.downloads.reveal(record.trackId)}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="iconbtn iconbtn--sm"
                    title={t('Удалить с диска')}
                    onClick={() => void removeDownload(record.trackId)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Page>
  )
}
