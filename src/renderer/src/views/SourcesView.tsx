/**
 * "Источники" — connect official provider APIs and search their catalogues.
 *
 * Two rules shape this screen:
 *   1. Keys are write-only for the renderer. They go straight to the encrypted
 *      store in the main process and are never read back.
 *   2. Sound comes from the provider's own embedded player. There is no
 *      stream-URL handling here, so nothing can turn into a downloader.
 */

import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ExternalProvider, SourcesStatus, Track } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useApp } from '../state/store'
import { playAll } from '../lib/play'
import { isExternalBlocked } from '../lib/external'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { TrackList } from '../components/TrackList'
import { EmptyState, TrackListSkeleton } from '../components/Feedback'
import { Switch } from '../components/Controls'
import { trackCountLabel } from '../lib/format'

const PROVIDERS: Record<
  ExternalProvider,
  {
    label: string
    short: string
    description: string
    keyLabel: string
    keyHint: string
    docsUrl: string
    docsLabel: string
  }
> = {
  youtube: {
    label: 'YouTube Music',
    short: 'YouTube',
    description:
      'Поиск через официальный YouTube Data API v3, воспроизведение — во встроенном IFrame Player. Реклама и ограничения YouTube остаются в силе.',
    keyLabel: 'Ключ YouTube Data API v3',
    keyHint: 'Создайте ключ в Google Cloud Console для включённого YouTube Data API v3.',
    docsUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    docsLabel: 'Открыть Google Cloud Console'
  },
  soundcloud: {
    label: 'SoundCloud',
    short: 'SoundCloud',
    description:
      'Поиск через официальный публичный API, воспроизведение — через официальный Widget Player. Часть треков авторы запрещают встраивать.',
    keyLabel: 'SoundCloud client_id',
    keyHint: 'client_id приложения, зарегистрированного в SoundCloud Developers.',
    docsUrl: 'https://developers.soundcloud.com/docs/api/guide',
    docsLabel: 'Документация SoundCloud'
  }
}

export function SourcesView(): JSX.Element {
  const settings = useApp((state) => state.settings)
  const updateSettings = useApp((state) => state.updateSettings)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const toast = useApp((state) => state.toast)

  const [provider, setProvider] = useState<ExternalProvider>('youtube')
  const [status, setStatus] = useState<SourcesStatus | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  /** Bumped by "Повторить" so an error on page 1 can be retried as well. */
  const [attempt, setAttempt] = useState(0)
  const [results, setResults] = useState<Track[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pageSize = 24
  const providerInfo = PROVIDERS[provider]
  const configured = status?.[provider]?.configured ?? false
  const enabled = settings.providers[provider]
  const online = settings.onlineProviders

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.sources.status())
    } catch (reason) {
      toast(`Не удалось прочитать состояние источников: ${errorMessage(reason)}`, 'error')
    }
  }, [toast])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  /* ----------------------------- search --------------------------- */

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed || !configured || !enabled || !online) {
      setResults([])
      setHasMore(false)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await api.sources.search({ provider, text: trimmed, page, pageSize })
          if (cancelled) return
          setResults(data.items)
          setHasMore(data.hasMore)
          setError(null)
        } catch (reason) {
          if (cancelled) return
          setResults([])
          setHasMore(false)
          setError(errorMessage(reason))
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, page, provider, configured, enabled, online, attempt])

  const switchProvider = (next: ExternalProvider): void => {
    if (next === provider) return
    setProvider(next)
    setPage(1)
    setResults([])
    setHasMore(false)
    setError(null)
    setKeyDraft('')
  }

  /* -------------------------- credentials ------------------------- */

  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (!value) return
    setSaving(true)
    try {
      setStatus(await api.sources.setCredential(provider, value))
      setKeyDraft('')
      setAttempt((value) => value + 1)
      toast(`${providerInfo.short}: ключ сохранён в зашифрованном виде`, 'success')
    } catch (reason) {
      toast(errorMessage(reason), 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async (): Promise<void> => {
    setSaving(true)
    try {
      setStatus(await api.sources.clearCredential(provider))
      setResults([])
      toast(`${providerInfo.short}: ключ удалён`, 'info')
    } catch (reason) {
      toast(errorMessage(reason), 'error')
    } finally {
      setSaving(false)
    }
  }

  /* ---------------------------- render ---------------------------- */

  const canSearch = configured && enabled && online
  const totalPages = hasMore ? page + 1 : page
  const blockedCount = results.filter((track) =>
    isExternalBlocked(catalogIndex.get(track.id) ?? track)
  ).length

  return (
    <Page className="page--sources">
      <PageHeader
        icon="link"
        title="Источники"
        subtitle="Официальные API сервисов. Kolaars не обходит ограничения и не скачивает защищённый звук."
      />

      <nav className="tabs tabs--inline sources__tabs">
        {(Object.keys(PROVIDERS) as ExternalProvider[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`tabs__item${provider === id ? ' tabs__item--active' : ''}`}
            onClick={() => switchProvider(id)}
          >
            <Icon name="external" size={15} />
            {PROVIDERS[id].label}
          </button>
        ))}
      </nav>

      <section className="panel sources__connect">
        <header className="panel__head">
          <div className="panel__headtext">
            <h2 className="panel__title">
              <Icon name="shield" size={16} />
              {providerInfo.label}
              <span className={`sources__status${configured ? ' sources__status--on' : ''}`}>
                {configured ? 'подключено' : 'не подключено'}
              </span>
            </h2>
            <p className="panel__description">{providerInfo.description}</p>
          </div>
        </header>

        <div className="panel__body">
          <div className="sources__row">
            <div className="sources__rowtext">
              <span className="field__label">Включить источник</span>
              <span className="field__hint">
                Выключенный источник не делает сетевых запросов, даже если ключ сохранён.
              </span>
            </div>
            <Switch
              label={`Включить ${providerInfo.label}`}
              checked={enabled}
              onChange={(value) =>
                void updateSettings({ providers: { ...settings.providers, [provider]: value } })
              }
            />
          </div>

          <div className="sources__row sources__row--key">
            <div className="sources__rowtext">
              <span className="field__label">{providerInfo.keyLabel}</span>
              <span className="field__hint">
                {configured ? 'Ключ сохранён. Его нельзя прочитать обратно — только заменить.' : providerInfo.keyHint}
              </span>
            </div>

            <div className="sources__keyform">
              <input
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                placeholder={configured ? 'Вставьте новый ключ' : 'Вставьте ключ'}
                onChange={(event) => setKeyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveKey()
                }}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={saving || keyDraft.trim().length === 0}
                onClick={() => void saveKey()}
              >
                {configured ? 'Заменить' : 'Сохранить'}
              </button>
              {configured ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={saving}
                  onClick={() => void removeKey()}
                >
                  Удалить
                </button>
              ) : null}
            </div>
          </div>

          <div className="sources__footer">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void api.app.openExternal(providerInfo.docsUrl)}
            >
              <Icon name="external" size={14} />
              {providerInfo.docsLabel}
            </button>
            <span className="sources__legal">
              Звук идёт из официального плеера сервиса. Скачивание и обход DRM не поддерживаются.
            </span>
          </div>
        </div>
      </section>

      {!online ? (
        <EmptyState
          icon="offline"
          title="Онлайн-источники выключены"
          text="Включите их в настройках, чтобы искать в подключённых сервисах."
          action={{
            label: 'Открыть настройки',
            icon: 'settings',
            onClick: () => useApp.getState().setRoute({ name: 'settings' })
          }}
        />
      ) : (
        <>
          <div className="searchbar sources__search">
            <Icon name="search" size={18} />
            <input
              className="input searchbar__input"
              value={query}
              spellCheck={false}
              maxLength={200}
              placeholder={canSearch ? 'Название трека или исполнитель' : 'Сначала подключите источник'}
              disabled={!canSearch}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            {query ? (
              <button
                type="button"
                className="iconbtn iconbtn--sm"
                title="Очистить"
                onClick={() => {
                  setQuery('')
                  setPage(1)
                }}
              >
                <Icon name="close" size={16} />
              </button>
            ) : null}
          </div>

          {!canSearch ? (
            <EmptyState
              icon="link"
              title={configured ? 'Источник выключен' : 'Нужен ключ'}
              text={
                configured
                  ? 'Включите переключатель выше, чтобы искать в этом сервисе.'
                  : providerInfo.keyHint
              }
            />
          ) : error ? (
            <EmptyState
              icon="alert"
              title="Поиск не удался"
              text={error}
              action={{ label: 'Повторить', icon: 'refresh', onClick: () => setAttempt((value) => value + 1) }}
            />
          ) : loading && results.length === 0 ? (
            <TrackListSkeleton rows={6} />
          ) : results.length === 0 ? (
            <EmptyState
              icon="search"
              title={query.trim() ? 'Ничего не найдено' : 'Что будем искать?'}
              text={
                query.trim()
                  ? 'Попробуйте другой запрос или проверьте ключ источника.'
                  : `Поиск идёт напрямую через ${providerInfo.short}.`
              }
            />
          ) : (
            <>
              <div className="results__bar">
                <span className="results__count">
                  {loading ? 'Обновляем…' : `${trackCountLabel(results.length)} найдено`}
                  {blockedCount > 0 ? ` · ${blockedCount} без встраивания` : ''}
                </span>
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
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => playAll(results, 0)}
                  >
                    <Icon name="play" size={14} />
                    Играть всё
                  </button>
                </div>
              </div>

              <TrackList tracks={results} showAlbum={false} />
            </>
          )}
        </>
      )}
    </Page>
  )
}
