/**
 * The one track list used everywhere.
 *
 * Behaviour is intentionally uniform: the index chip and the title play the
 * track, the heart toggles a favourite, the "…" opens `TrackMenu`, and the row
 * highlights (with a pause glyph) while it is the track being played.
 */

import type { JSX, ReactNode } from 'react'
import type { Track } from '@shared/types'
import { formatTime } from '../lib/format'
import { useApp } from '../state/store'
import { usePlayer } from '../state/player'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { TrackMenu } from './TrackMenu'

export interface TrackListProps {
  tracks: Track[]
  /** Rendered instead of the list when `tracks` is empty. */
  empty?: ReactNode
  showAlbum?: boolean
  showCover?: boolean
  header?: boolean
  /** Overrides what "play this row" does (default: play the whole list). */
  onPlay?: (track: Track, index: number, list: Track[]) => void
  /** Adds a trailing remove button (used by playlists). */
  onRemove?: (track: Track) => void
  removeTitle?: string
  /** Overrides the menu column entirely. */
  renderActions?: (track: Track, index: number) => ReactNode
}

export function TrackList({
  tracks,
  empty,
  showAlbum = true,
  showCover = true,
  header = true,
  onPlay,
  onRemove,
  removeTitle = 'Убрать',
  renderActions
}: TrackListProps): JSX.Element {
  if (tracks.length === 0 && empty) return <>{empty}</>

  const play = (track: Track, index: number): void => {
    if (onPlay) onPlay(track, index, tracks)
    else usePlayer.getState().playTracks(tracks, index)
  }

  const variant = showCover && showAlbum ? 'cover-album' : showCover ? 'cover' : showAlbum ? 'album' : 'plain'

  return (
    <div className={`tracklist tracklist--${variant}`} role="table" aria-label="Треки">
      {header ? (
        <div className="tracklist__head" role="row">
          <span className="tracklist__cell tracklist__cell--index">#</span>
          {showCover ? <span className="tracklist__cell tracklist__cell--cover" /> : null}
          <span className="tracklist__cell">Название</span>
          {showAlbum ? <span className="tracklist__cell tracklist__cell--album">Альбом</span> : null}
          <span className="tracklist__cell tracklist__cell--time">
            <Icon name="clock" size={14} />
          </span>
          <span className="tracklist__cell tracklist__cell--actions" />
        </div>
      ) : null}

      {tracks.map((track, index) => (
        <TrackRow
          key={`${track.id}-${index}`}
          track={track}
          index={index}
          showAlbum={showAlbum}
          showCover={showCover}
          onPlay={() => play(track, index)}
          onRemove={onRemove ? () => onRemove(track) : undefined}
          removeTitle={removeTitle}
          renderActions={renderActions}
        />
      ))}
    </div>
  )
}

interface TrackRowProps {
  track: Track
  index: number
  showAlbum: boolean
  showCover: boolean
  onPlay: () => void
  onRemove?: () => void
  removeTitle: string
  renderActions?: (track: Track, index: number) => ReactNode
}

function TrackRow({
  track,
  index,
  showAlbum,
  showCover,
  onPlay,
  onRemove,
  removeTitle,
  renderActions
}: TrackRowProps): JSX.Element {
  const isCurrent = usePlayer((state) => state.currentId === track.id)
  const playing = usePlayer((state) => (state.currentId === track.id ? state.playing : false))
  const favorite = useApp((state) => state.favorites.has(track.id))
  const hasLyrics = useApp((state) => state.lyricsIds.has(track.id))
  const unavailable = !track.streamUrl && !track.identifier && !track.external

  return (
    <div
      className={`trackrow${isCurrent ? ' trackrow--current' : ''}${unavailable ? ' trackrow--unavailable' : ''}`}
      role="row"
      onDoubleClick={onPlay}
    >
      <button
        type="button"
        className="trackrow__index"
        title={isCurrent && playing ? 'Пауза' : 'Воспроизвести'}
        onClick={() => (isCurrent ? usePlayer.getState().toggle() : onPlay())}
      >
        <span className="trackrow__number">{index + 1}</span>
        <Icon
          className="trackrow__playicon"
          name={isCurrent && playing ? 'pause' : 'play'}
          size={13}
        />
      </button>

      {showCover ? (
        <Cover
          src={track.artwork}
          alt={track.title}
          rounded="sm"
          className="trackrow__cover"
          icon="music"
        />
      ) : null}

      <div className="trackrow__main">
        <button type="button" className="trackrow__titlebtn" title={track.title} onClick={onPlay}>
          <span className="trackrow__title">{track.title}</span>
        </button>
        <span className="trackrow__subtitle">
          {track.artist}
          {showAlbum && track.album ? ` · ${track.album}` : ''}
        </span>
        <span className="trackrow__badges">
          {track.external ? (
            <span className="badge" title="Воспроизводится официальным плеером сервиса">
              <Icon name="external" size={11} />
              {track.external.provider === 'youtube' ? 'YouTube' : 'SoundCloud'}
            </span>
          ) : null}
          {track.offline ? (
            <span className="badge" title="Доступно офлайн">
              <Icon name="offline" size={11} />
              офлайн
            </span>
          ) : null}
          {hasLyrics ? (
            <span className="badge badge--accent" title="Есть сохранённый текст">
              <Icon name="lyrics" size={11} />
            </span>
          ) : null}
          {unavailable ? (
            <span className="badge" title="Ссылка на аудио недоступна">
              <Icon name="alert" size={11} />
            </span>
          ) : null}
        </span>
      </div>

      {showAlbum ? <span className="trackrow__album">{track.album ?? '—'}</span> : null}

      <span className="trackrow__duration">{formatTime(track.duration)}</span>

      <span className="trackrow__actions">
        <button
          type="button"
          className={`iconbtn iconbtn--sm trackrow__fav${favorite ? ' iconbtn--active' : ''}`}
          title={favorite ? 'Убрать из избранного' : 'В избранное'}
          onClick={() => void useApp.getState().toggleFavorite(track.id)}
        >
          <Icon name={favorite ? 'heart-filled' : 'heart'} size={16} />
        </button>

        {renderActions ? (
          renderActions(track, index)
        ) : onRemove ? (
          <button
            type="button"
            className="iconbtn iconbtn--sm trackrow__remove"
            title={removeTitle}
            onClick={onRemove}
          >
            <Icon name="close" size={16} />
          </button>
        ) : (
          <TrackMenu track={track} />
        )}
      </span>
    </div>
  )
}
