/**
 * Full-window "now playing" screen: large artwork on the left, lyrics on the
 * right. Opened from the player bar and closed with Escape or the back chip.
 */

import type { JSX } from 'react'
import { formatTime } from '../lib/format'
import { useApp, useIsFavorite, useTrack } from '../state/store'
import { usePlayer } from '../state/player'
import { api } from '../lib/api'
import { Cover } from './Cover'
import { GrainCanvas } from './GrainCanvas'
import { Icon } from './Icon'
import { LyricsPanel } from './LyricsPanel'
import { SeekBar, TransportControls, VolumeBar } from './PlayerBar'

export function NowPlaying(): JSX.Element {
  const currentId = usePlayer((state) => state.currentId)
  const track = useTrack(currentId)
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  const favorite = useIsFavorite(currentId)
  const setNowPlayingOpen = useApp((state) => state.setNowPlayingOpen)
  const setQueueOpen = useApp((state) => state.setQueueOpen)

  const close = (): void => setNowPlayingOpen(false)

  return (
    <div className="nowplaying">
      <header className="nowplaying__bar">
        <button type="button" className="btn btn--ghost btn--sm" title="Свернуть (Esc)" onClick={close}>
          <Icon name="chevron-down" size={16} />
          Свернуть
        </button>
        <span className="nowplaying__label">
          <Icon name="disc" size={15} />
          Сейчас играет
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          title="Показать очередь"
          onClick={() => {
            close()
            setQueueOpen(true)
          }}
        >
          <Icon name="queue" size={16} />
          Очередь
        </button>
      </header>

      <div className="nowplaying__body">
        <section className="nowplaying__art">
          <div className="nowplaying__artwrap">
            <Cover
              src={track?.artwork}
              alt={track?.title ?? 'Нет трека'}
              rounded="lg"
              className="nowplaying__cover"
              icon="disc"
            />
            <GrainCanvas className="nowplaying__grain" />
          </div>

          <div className="nowplaying__info">
            <h1 className="nowplaying__title">{track?.title ?? 'Ничего не играет'}</h1>
            <p className="nowplaying__artist">{track?.artist ?? '—'}</p>

            <div className="nowplaying__tags">
              {track?.album ? <span className="chip">{track.album}</span> : null}
              {track?.year ? <span className="chip">{track.year}</span> : null}
              {track?.source === 'local' ? (
                <span className="chip">
                  <Icon name="folder" size={13} />
                  Локальный файл
                </span>
              ) : null}
              {track?.offline ? (
                <span className="chip">
                  <Icon name="offline" size={13} />
                  Офлайн
                </span>
              ) : null}
              {track?.license ? (
                <span className="chip" title={track.licenseUrl ?? undefined}>
                  <Icon name="shield" size={13} />
                  {track.license}
                </span>
              ) : null}
            </div>

            {track?.sourceUrl ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void api.app.openExternal(track.sourceUrl as string)}
              >
                <Icon name="external" size={14} />
                Страница записи
              </button>
            ) : null}
          </div>
        </section>

        <section className="nowplaying__lyrics">
          <LyricsPanel track={track ?? null} variant="full" />
        </section>
      </div>

      {/* Full width on purpose: the seek bar is the one control worth the whole
       * screen, and the artwork column would have kept it to 560 px. */}
      <footer className="nowplaying__foot">
        <SeekBar
          position={position}
          duration={duration}
          className="seekbar--lg"
          onSeek={(seconds) => usePlayer.getState().seek(seconds)}
        />
        <div className="nowplaying__times">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="nowplaying__controls">
          <TransportControls size="lg" />
          <div className="nowplaying__extras">
            <button
              type="button"
              className={`iconbtn${favorite ? ' iconbtn--active' : ''}`}
              title={favorite ? 'Убрать из избранного (F)' : 'В избранное (F)'}
              disabled={!track}
              onClick={() => {
                if (currentId) void useApp.getState().toggleFavorite(currentId)
              }}
            >
              <Icon name={favorite ? 'heart-filled' : 'heart'} size={19} />
            </button>
            <VolumeBar />
          </div>
        </div>
      </footer>
    </div>
  )
}
