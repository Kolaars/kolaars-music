/**
 * Discover — the landing view.
 *
 * Shelves come from the seed catalog instantly (so a fresh, offline install has
 * something to show) and are upgraded in the background with live archive.org
 * results, three requests at a time.
 */

import { useEffect, useMemo, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { api } from '../lib/api'
import { playAll, playRandom, shuffleAll } from '../lib/play'
import { formatTime, trackCountLabel } from '../lib/format'
import { useApp } from '../state/store'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { Page, PageHeader } from '../components/Page'
import { ShelfSkeleton } from '../components/Feedback'

export function DiscoverView(): JSX.Element {
  const shelves = useApp((state) => state.shelves)
  const seedTracks = useApp((state) => state.seedTracks)
  const setRoute = useApp((state) => state.setRoute)
  const setSearchQuery = useApp((state) => state.setSearchQuery)

  const [live, setLive] = useState<Record<string, Track[]>>({})
  const [genres, setGenres] = useState<{ name: string; count: number }[]>([])

  const seedByShelf = useMemo(() => {
    const map: Record<string, Track[]> = {}
    for (const track of seedTracks) {
      const shelf = (track as Track & { shelf?: string }).shelf
      if (!shelf) continue
      ;(map[shelf] ??= []).push(track)
    }
    return map
  }, [seedTracks])

  useEffect(() => {
    void api.catalog
      .genres()
      .then(setGenres)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (shelves.length === 0) return
    let cancelled = false
    const queue = shelves.map((shelf) => shelf.id)
    let cursor = 0

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++
        if (index >= queue.length) return
        const id = queue[index]
        try {
          const tracks = await api.archive.shelfTracks(id, 18)
          if (cancelled || tracks.length === 0) continue
          setLive((previous) => ({ ...previous, [id]: tracks }))
        } catch {
          /* the seed fallback is already on screen */
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    return () => {
      cancelled = true
    }
  }, [shelves])

  const jumpToGenre = (name: string): void => {
    setSearchQuery(name)
    setRoute({ name: 'search', query: name })
  }

  return (
    <Page className="page--discover">
      <section className="hero">
        <div className="hero__glow" />
        <div className="hero__text">
          <span className="hero__eyebrow">
            <Icon name="sparkles" size={14} />
            Открытая музыка и открытые тексты
          </span>
          <h1 className="hero__title">Музыка в общественном достоянии</h1>
          <p className="hero__lead">
            Коллекция Kolaars собрана из Internet Archive: шеллачные пластинки Great&nbsp;78, записи Musopen и
            релизы независимых лейблов под лицензиями Creative&nbsp;Commons. Слушайте бесплатно и легально.
          </p>
          <div className="hero__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={seedTracks.length === 0}
              onClick={() => playRandom(seedTracks)}
            >
              <Icon name="play" size={16} />
              Включить случайный трек
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setRoute({ name: 'search' })}>
              <Icon name="search" size={16} />
              Искать в архиве
            </button>
          </div>
          <p className="hero__meta">
            {trackCountLabel(seedTracks.length)} в офлайн-каталоге · {shelves.length} подборок
          </p>
        </div>
      </section>

      {genres.length > 0 ? (
        <section className="chipsrow">
          <span className="chipsrow__label">Жанры</span>
          <div className="chipsrow__items">
            {genres.slice(0, 16).map((genre) => (
              <button
                key={genre.name}
                type="button"
                className="chip chip--interactive"
                title={`${genre.count} записей`}
                onClick={() => jumpToGenre(genre.name)}
              >
                {genre.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {shelves.length === 0 ? (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      ) : (
        shelves.map((shelf) => {
          const tracks = live[shelf.id] ?? seedByShelf[shelf.id] ?? []
          const loading = tracks.length === 0
          return (
            <section className="shelf" key={shelf.id}>
              <header className="shelf__head">
                <div className="shelf__headtext">
                  <h2 className="shelf__title">{shelf.title}</h2>
                  <p className="shelf__subtitle">{shelf.subtitle}</p>
                </div>
                <div className="shelf__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={tracks.length === 0}
                    onClick={() => playAll(tracks)}
                  >
                    <Icon name="play" size={15} />
                    Играть
                  </button>
                  <button
                    type="button"
                    className="iconbtn iconbtn--sm"
                    title="Перемешать подборку"
                    disabled={tracks.length === 0}
                    onClick={() => shuffleAll(tracks)}
                  >
                    <Icon name="shuffle" size={16} />
                  </button>
                </div>
              </header>

              {loading ? (
                <ShelfSkeleton cards={6} />
              ) : (
                <div className="shelf__row">
                  {tracks.map((track, index) => (
                    <article
                      className="card"
                      key={`${shelf.id}-${track.id}-${index}`}
                      onDoubleClick={() => playAll(tracks, index)}
                    >
                      <div className="card__artwrap">
                        <Cover
                          src={track.artwork}
                          alt={track.title}
                          rounded="md"
                          className="card__art"
                          icon="disc"
                        />
                        <button
                          type="button"
                          className="card__play"
                          title="Воспроизвести"
                          onClick={() => playAll(tracks, index)}
                        >
                          <Icon name="play" size={18} />
                        </button>
                      </div>
                      <span className="card__title" title={track.title}>
                        {track.title}
                      </span>
                      <span className="card__sub" title={track.artist}>
                        {track.artist}
                      </span>
                      <span className="card__foot">
                        {track.year ? <span>{track.year}</span> : <span>—</span>}
                        <span>{track.duration ? formatTime(track.duration) : '—'}</span>
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}
    </Page>
  )
}
