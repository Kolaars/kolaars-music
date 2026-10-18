/**
 * Library — everything the user brought in themselves: imported files and
 * offline downloads, plus a "recently played" tab driven by the play history.
 */

import { useMemo, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { useApp } from '../state/store'
import { playAll, shuffleAll } from '../lib/play'
import { formatRelativeDate, trackCountLabel } from '../lib/format'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { TrackList } from '../components/TrackList'
import { EmptyState } from '../components/Feedback'
import { Select } from '../components/Controls'

type Tab = 'tracks' | 'recent'
type SortKey = 'added' | 'title' | 'artist' | 'year'

export function LibraryView(): JSX.Element {
  const userTracks = useApp((state) => state.userTracks)
  const history = useApp((state) => state.history)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const importFiles = useApp((state) => state.importFiles)
  const importFolder = useApp((state) => state.importFolder)
  const clearHistory = useApp((state) => state.clearHistory)
  const importProgress = useApp((state) => state.importProgress)

  const [tab, setTab] = useState<Tab>('tracks')
  const [sort, setSort] = useState<SortKey>('added')
  const [filter, setFilter] = useState('')

  const tracks = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const filtered = needle
      ? userTracks.filter((track) =>
          `${track.title} ${track.artist} ${track.album ?? ''}`.toLowerCase().includes(needle)
        )
      : [...userTracks]

    switch (sort) {
      case 'title':
        return filtered.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
      case 'artist':
        return filtered.sort((a, b) => a.artist.localeCompare(b.artist, 'ru'))
      case 'year':
        return filtered.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      default:
        return filtered.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    }
  }, [userTracks, sort, filter])

  const recent: Track[] = useMemo(
    () =>
      [...history]
        .reverse()
        .map((entry) => catalogIndex.get(entry.trackId))
        .filter((track): track is Track => Boolean(track)),
    [history, catalogIndex]
  )

  const list = tab === 'tracks' ? tracks : recent

  return (
    <Page className="page--library">
      <PageHeader
        icon="library"
        title="Библиотека"
        subtitle={`${trackCountLabel(userTracks.length)} — импортированные файлы и офлайн-загрузки`}
        actions={
          <>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void importFolder()}>
              <Icon name="folder" size={15} />
              Папка
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void importFiles()}>
              <Icon name="plus" size={15} />
              Добавить музыку
            </button>
          </>
        }
      />

      {importProgress ? (
        <div className="progress-banner">
          <Icon name="upload" size={15} />
          <span>
            Импорт {importProgress.done} из {importProgress.total}: {importProgress.current}
          </span>
          <div className="progress-line">
            <div
              className="progress-line__fill"
              style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <nav className="tabs tabs--inline">
          <button
            type="button"
            className={`tabs__item${tab === 'tracks' ? ' tabs__item--active' : ''}`}
            onClick={() => setTab('tracks')}
          >
            <Icon name="music" size={15} />
            Треки
            <span className="tabs__count">{userTracks.length}</span>
          </button>
          <button
            type="button"
            className={`tabs__item${tab === 'recent' ? ' tabs__item--active' : ''}`}
            onClick={() => setTab('recent')}
          >
            <Icon name="clock" size={15} />
            Недавние
            <span className="tabs__count">{recent.length}</span>
          </button>
        </nav>

        <div className="toolbar__right">
          {tab === 'tracks' ? (
            <>
              <div className="searchbar searchbar--inline">
                <Icon name="search" size={16} />
                <input
                  className="input"
                  value={filter}
                  spellCheck={false}
                  placeholder="Фильтр"
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
              <Select<SortKey>
                label="Сортировка"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'added', label: 'Недавно добавленные' },
                  { value: 'title', label: 'По названию' },
                  { value: 'artist', label: 'По исполнителю' },
                  { value: 'year', label: 'По году' }
                ]}
              />
            </>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={recent.length === 0}
              onClick={() => void clearHistory()}
            >
              <Icon name="trash" size={15} />
              Очистить историю
            </button>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={list.length === 0}
            onClick={() => playAll(list)}
          >
            <Icon name="play" size={15} />
            Играть
          </button>
          <button
            type="button"
            className="iconbtn iconbtn--sm"
            title="Перемешать"
            disabled={list.length === 0}
            onClick={() => shuffleAll(list)}
          >
            <Icon name="shuffle" size={16} />
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        tab === 'tracks' ? (
          <EmptyState
            icon="upload"
            title="Библиотека пуста"
            text="Добавьте свои аудиофайлы — Kolaars читает теги, обложки и автоматически подхватывает соседние .lrc-файлы. Или скачайте трек из каталога для прослушивания офлайн."
            action={{ label: 'Добавить музыку', icon: 'plus', onClick: () => void importFiles() }}
          />
        ) : (
          <EmptyState
            icon="clock"
            title="История пуста"
            text="Включите любой трек — недавно прослушанное появится здесь."
            action={{ label: 'Открыть обзор', icon: 'compass', onClick: () => useApp.getState().setRoute({ name: 'discover' }) }}
          />
        )
      ) : (
        <TrackList tracks={list} />
      )}

      {recent.length > 0 && tab === 'recent' ? (
        <p className="page__note">
          Последнее прослушивание: {formatRelativeDate(history[history.length - 1]?.at)}
        </p>
      ) : null}
    </Page>
  )
}
