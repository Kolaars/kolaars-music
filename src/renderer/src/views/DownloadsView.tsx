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
        title="Загрузки"
        subtitle={
          downloads.length === 0
            ? 'Офлайн-копии треков хранятся на диске и играют без интернета'
            : `${done.length} готово · ${active.length} в процессе · ${formatBytes(totalBytes)} на диске`
        }
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refreshDownloads()}>
            <Icon name="refresh" size={15} />
            Обновить
          </button>
        }
      />

      {downloads.length === 0 ? (
        <EmptyState
          icon="download"
          title="Загрузок пока нет"
          text="Откройте меню «…» у любого трека и выберите «Скачать офлайн» — копия появится здесь."
          action={{ label: 'Открыть обзор', icon: 'compass', onClick: () => setRoute({ name: 'discover' }) }}
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
                    <span className={`badge badge--${record.status}`}>{STATUS_LABEL[record.status]}</span>
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
                      Отменить
                    </button>
                  ) : null}

                  {record.status === 'done' ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!track}
                      onClick={() => (track ? playAll([track]) : undefined)}
                    >
                      <Icon name="play" size={15} />
                      Играть
                    </button>
                  ) : null}

                  {record.status === 'error' || record.status === 'cancelled' ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!track}
                      onClick={() => (track ? void startDownload(track) : undefined)}
                    >
                      <Icon name="refresh" size={15} />
                      Повторить
                    </button>
                  ) : null}

                  {record.status === 'done' ? (
                    <button
                      type="button"
                      className="iconbtn iconbtn--sm"
                      title="Показать в папке"
                      onClick={() => void api.downloads.reveal(record.trackId)}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="iconbtn iconbtn--sm"
                    title="Удалить с диска"
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
