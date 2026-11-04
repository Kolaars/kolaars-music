/** Favourites — the tracks the user hearted, in one list. */

import { useMemo, type JSX } from 'react'
import type { Track } from '@shared/types'
import { useApp } from '../state/store'
import { playAll, shuffleAll } from '../lib/play'
import { trackCountLabel } from '../lib/format'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { TrackList } from '../components/TrackList'
import { EmptyState } from '../components/Feedback'
import { t } from '../lib/i18n'

export function FavoritesView(): JSX.Element {
  const favorites = useApp((state) => state.favorites)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const setRoute = useApp((state) => state.setRoute)

  const tracks: Track[] = useMemo(
    () =>
      Array.from(favorites)
        .map((id) => catalogIndex.get(id))
        .filter((track): track is Track => Boolean(track))
        .sort((a, b) => a.title.localeCompare(b.title, 'ru')),
    [favorites, catalogIndex]
  )

  return (
    <Page className="page--favorites">
      <PageHeader
        icon="heart"
        title={t('Избранное')}
        subtitle={t('{0} отмечено сердцем', { 0: trackCountLabel(tracks.length) })}
        actions={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={tracks.length === 0}
              onClick={() => playAll(tracks)}
            >
              <Icon name="play" size={15} />
              {t('Играть')}</button>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              title={t('Перемешать')}
              disabled={tracks.length === 0}
              onClick={() => shuffleAll(tracks)}
            >
              <Icon name="shuffle" size={16} />
            </button>
          </>
        }
      />

      {tracks.length === 0 ? (
        <EmptyState
          icon="heart"
          title={t('Пока пусто')}
          text={t('Отмечайте понравившиеся записи значком сердца — они соберутся здесь.')}
          action={{ label: t('Открыть обзор'), icon: 'compass', onClick: () => setRoute({ name: 'discover' }) }}
        />
      ) : (
        <TrackList tracks={tracks} />
      )}
    </Page>
  )
}
