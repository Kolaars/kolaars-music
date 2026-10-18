/** All playlists, as a responsive grid of mosaic cards. */

import { useMemo, type JSX } from 'react'
import { useApp } from '../state/store'
import { trackCountLabel } from '../lib/format'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/Feedback'

export function PlaylistsView({ onNewPlaylist }: { onNewPlaylist: () => void }): JSX.Element {
  const playlists = useApp((state) => state.playlists)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const setRoute = useApp((state) => state.setRoute)

  const artworksFor = useMemo(
    () => (trackIds: string[]): string[] =>
      trackIds
        .map((id) => catalogIndex.get(id)?.artwork)
        .filter((artwork): artwork is string => Boolean(artwork))
        .slice(0, 4),
    [catalogIndex]
  )

  return (
    <Page className="page--playlists">
      <PageHeader
        icon="disc"
        title="Плейлисты"
        subtitle={`${playlists.length} коллекций`}
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={onNewPlaylist}>
            <Icon name="plus" size={15} />
            Новый плейлист
          </button>
        }
      />

      {playlists.length === 0 ? (
        <EmptyState
          icon="disc"
          title="Плейлистов пока нет"
          text="Соберите свою подборку: создайте плейлист и добавляйте в него треки через меню «…» в списках."
          action={{ label: 'Создать плейлист', icon: 'plus', onClick: onNewPlaylist }}
        />
      ) : (
        <div className="playlist-grid">
          {playlists.map((playlist) => {
            const artworks = artworksFor(playlist.trackIds)
            return (
              <button
                key={playlist.id}
                type="button"
                className="playlist-card"
                onClick={() => setRoute({ name: 'playlist', id: playlist.id })}
              >
                <span
                  className={`playlist-card__art${
                    artworks.length > 1 ? ' playlist-card__art--grid' : ' playlist-card__art--single'
                  }`}
                >
                  {artworks.length === 0 ? (
                    <Icon name="disc" size={30} />
                  ) : artworks.length === 1 ? (
                    <span className="playlist-card__tile">
                      <img src={artworks[0] ?? ''} alt="" loading="lazy" draggable={false} />
                    </span>
                  ) : (
                    Array.from({ length: 4 }, (_, index) => {
                      const src = artworks[index % artworks.length]
                      return (
                        <span className="playlist-card__tile" key={index}>
                          {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : null}
                        </span>
                      )
                    })
                  )}
                </span>
                <span className="playlist-card__name">{playlist.name}</span>
                <span className="playlist-card__meta">{trackCountLabel(playlist.trackIds.length)}</span>
              </button>
            )
          })}
        </div>
      )}
    </Page>
  )
}
