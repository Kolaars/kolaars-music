/**
 * Search across Internet Archive or the offline catalog.
 *
 * The query lives in the app store so the menu's "Поиск" accelerator and the
 * `/` shortcut can drop the user here with the field focused.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useApp } from '../state/store'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { TrackList } from '../components/TrackList'
import { EmptyState, TrackListSkeleton } from '../components/Feedback'
import { trackCountLabel } from '../lib/format'

type Scope = 'archive' | 'library'

const SUGGESTIONS = ['jazz', 'blues', 'ragtime', 'waltz', 'spiritual', 'classical', 'opera', 'country']

export function SearchView(): JSX.Element {
  const query = useApp((state) => state.searchQuery)
  const searchQuery = useApp((state) => state.searchQuery)
  const setSearchQuery = useApp((state) => state.setSearchQuery)

  const [scope, setScope] = useState<Scope>('archive')
  const [collection, setCollection] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<Track[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pageSize = 24
  const lastKey = useRef('')

  useEffect(() => {
    const trimmed = query.trim()
    const key = `${scope}|${collection ?? ''}|${trimmed}`

    if (key !== lastKey.current) {
      lastKey.current = key
      if (page !== 1) {
        setPage(1)
        return
      }
    }

    if (!trimmed) {
      setResults([])
      setTotal(0)
      setError(null)
      setLoading(false)
      return
    }

    if (scope === 'library') {
      const needle = trimmed.toLowerCase()
      const matches = useApp
        .getState()
        .catalog.filter((track) =>
          `${track.title} ${track.artist} ${track.album ?? ''}`.toLowerCase().includes(needle)
        )
      setResults(matches.slice(0, 500))
      setTotal(matches.length)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await api.archive.search({
          text: trimmed,
          page,
          pageSize,
          collection
        })
        if (cancelled) return
        setResults(data.items)
        setTotal(data.total)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setResults([])
        setTotal(0)
        setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, scope, collection, page])

  const hasMore = scope === 'archive' && page * pageSize < total
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Page className="page--search">
      <PageHeader
        icon="search"
        title="Поиск"
        subtitle="Internet Archive и ваш офлайн-каталог. Поддерживаются поля archive.org: collection:, creator:, subject:"
      />

      <div className="searchbar">
        <Icon name="search" size={18} />
        <input
          id="global-search"
          className="input searchbar__input"
          value={query}
          spellCheck={false}
          placeholder="Название, исполнитель или запрос archive.org"
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setPage(1)
          }}
        />
        {query ? (
          <button
            type="button"
            className="iconbtn iconbtn--sm"
            title="Очистить"
            onClick={() => setSearchQuery('')}
          >
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>

      <div className="searchbar__meta">
        <nav className="tabs tabs--inline">
          <button
            type="button"
            className={`tabs__item${scope === 'archive' ? ' tabs__item--active' : ''}`}
            onClick={() => setScope('archive')}
          >
            <Icon name="globe" size={15} />
            Internet Archive
          </button>
          <button
            type="button"
            className={`tabs__item${scope === 'library' ? ' tabs__item--active' : ''}`}
            onClick={() => setScope('library')}
          >
            <Icon name="library" size={15} />
            Моя библиотека
          </button>
        </nav>

        {scope === 'archive' ? (
          <div className="chipsrow chipsrow--compact">
            <button
              type="button"
              className={`chip chip--interactive${collection === null ? ' chip--active' : ''}`}
              onClick={() => setCollection(null)}
            >
              Везде
            </button>
            {[
              { id: 'georgeblood', label: 'Great 78' },
              { id: 'musopen', label: 'Musopen' },
              { id: 'netlabels', label: 'Netlabels' }
            ].map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`chip chip--interactive${collection === entry.id ? ' chip--active' : ''}`}
                onClick={() => setCollection(collection === entry.id ? null : entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!searchQuery.trim() ? (
        <>
          <div className="chipsrow">
            <span className="chipsrow__label">Популярное</span>
            <div className="chipsrow__items">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="chip chip--interactive"
                  onClick={() => setSearchQuery(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          <EmptyState
            icon="search"
            title="Что будем искать?"
            text="Введите запрос или воспользуйтесь подсказками. Результаты приходят прямо из открытых API Internet Archive."
          />
        </>
      ) : error ? (
        <EmptyState
          icon="alert"
          title="Поиск не удался"
          text={`${error}. Проверьте подключение к сети — офлайн-каталог доступен в разделе «Обзор».`}
          action={{ label: 'Повторить', icon: 'refresh', onClick: () => setPage(1) }}
        />
      ) : loading && results.length === 0 ? (
        <TrackListSkeleton rows={8} />
      ) : results.length === 0 ? (
        <EmptyState
          icon="search"
          title="Ничего не найдено"
          text="Попробуйте другой запрос или снимите фильтр по коллекции."
        />
      ) : (
        <>
          <div className="results__bar">
            <span className="results__count">
              {loading ? 'Обновляем…' : `${trackCountLabel(total)} найдено`}
            </span>
            {scope === 'archive' ? (
              <div className="results__pager">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <Icon name="chevron-left" size={15} />
                  Назад
                </button>
                <span className="results__page">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Дальше
                  <Icon name="chevron-right" size={15} />
                </button>
              </div>
            ) : null}
          </div>

          <TrackList tracks={results} />
        </>
      )}
    </Page>
  )
}
