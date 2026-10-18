/** One Internet Archive item, shown as an album. */

import { useEffect, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { playAll, shuffleAll } from '../lib/play'
import { trackCountLabel } from '../lib/format'
import { useApp } from '../state/store'
import { Page } from '../components/Page'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { TrackList } from '../components/TrackList'
import { EmptyState, TrackListSkeleton } from '../components/Feedback'

interface AlbumData {
  tracks: Track[]
  album: string
  artist: string
  artwork: string
  license: string
}

export function AlbumView({
  identifier,
  title
}: {
  identifier: string
  title?: string
}): JSX.Element {
  const setRoute = useApp((state) => state.setRoute)
  const [data, setData] = useState<AlbumData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    api.archive
      .item(identifier)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setData(null)
          setError('Не удалось получить данные записи')
          return
        }
        setData(result)
        useApp.getState().cacheTracks(result.tracks)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [identifier])

  if (loading && !data) {
    return (
      <Page className="page--album">
        <TrackListSkeleton rows={8} />
      </Page>
    )
  }

  if (!data) {
    return (
      <Page className="page--album">
        <EmptyState
          icon="alert"
          title="Запись недоступна"
          text={error ?? 'Не удалось загрузить данные этой записи Internet Archive.'}
          action={{ label: 'К обзору', icon: 'compass', onClick: () => setRoute({ name: 'discover' }) }}
        />
      </Page>
    )
  }

  return (
    <Page className="page--album">
      <header className="albumhero">
        <Cover src={data.artwork} alt={data.album} rounded="lg" className="albumhero__cover" icon="disc" />
        <div className="albumhero__text">
          <span className="hero__eyebrow">
            <Icon name="disc" size={14} />
            Internet Archive
          </span>
          <h1 className="albumhero__title">{data.album || title || identifier}</h1>
          <p className="albumhero__artist">{data.artist}</p>
          <div className="albumhero__meta">
            <span>{trackCountLabel(data.tracks.length)}</span>
            {data.license ? (
              <span className="chip">
                <Icon name="shield" size={13} />
                {data.license}
              </span>
            ) : null}
          </div>
          <div className="albumhero__actions">
            <button type="button" className="btn btn--primary" onClick={() => playAll(data.tracks)}>
              <Icon name="play" size={16} />
              Слушать
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => shuffleAll(data.tracks)}>
              <Icon name="shuffle" size={16} />
              Перемешать
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void api.app.openExternal(`https://archive.org/details/${encodeURIComponent(identifier)}`)}
            >
              <Icon name="external" size={16} />
              На сайте архива
            </button>
          </div>
        </div>
      </header>

      <TrackList tracks={data.tracks} showAlbum={false} />
    </Page>
  )
}
