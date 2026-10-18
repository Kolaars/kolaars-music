/**
 * Bottom player bar, plus the transport widgets it shares with Now Playing.
 *
 * Everything reads straight from the player store; the bar is deliberately thin
 * so the 15 fps position updates never touch the heavy library views.
 */

import { useState, type JSX } from 'react'
import { formatTime } from '../lib/format'
import { useApp, useIsFavorite, useTrack } from '../state/store'
import { usePlayer } from '../state/player'
import { Cover } from './Cover'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export function SeekBar({
  position,
  duration,
  onSeek,
  className
}: {
  position: number
  duration: number
  onSeek: (seconds: number) => void
  className?: string
}): JSX.Element {
  const [scrub, setScrub] = useState<number | null>(null)
  const value = scrub ?? Math.min(position, duration || position)
  const percent = duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0

  return (
    <input
      type="range"
      className={`seekbar${className ? ` ${className}` : ''}`}
      min={0}
      max={duration > 0 ? duration : 100}
      step={0.25}
      value={value}
      disabled={duration <= 0}
      aria-label="Позиция воспроизведения"
      style={{ ['--seek' as string]: `${percent}%` }}
      onChange={(event) => {
        const next = Number(event.target.value)
        setScrub(next)
        onSeek(next)
      }}
      onPointerUp={() => setScrub(null)}
      onBlur={() => setScrub(null)}
    />
  )
}

export function VolumeBar(): JSX.Element {
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const setVolume = usePlayer((state) => state.setVolume)
  const toggleMute = usePlayer((state) => state.toggleMute)

  const icon = muted || volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'
  const shown = muted ? 0 : volume

  return (
    <div className="volumebar">
      <button
        type="button"
        className="iconbtn iconbtn--sm"
        title={muted ? 'Включить звук (M)' : 'Выключить звук (M)'}
        onClick={toggleMute}
      >
        <Icon name={icon} size={17} />
      </button>
      <input
        type="range"
        className="volumebar__range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label="Громкость"
        style={{ ['--seek' as string]: `${shown * 100}%` }}
        onChange={(event) => setVolume(Number(event.target.value))}
      />
    </div>
  )
}

export function TransportControls({ size = 'md' }: { size?: 'md' | 'lg' }): JSX.Element {
  const playing = usePlayer((state) => state.playing)
  const buffering = usePlayer((state) => state.buffering)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const hasQueue = usePlayer((state) => state.queue.length > 0)
  const big = size === 'lg'

  return (
    <div className={`transport transport--${size}`}>
      <button
        type="button"
        className={`iconbtn${shuffle ? ' iconbtn--active' : ''}`}
        title="Случайный порядок (S)"
        onClick={() => usePlayer.getState().toggleShuffle()}
      >
        <Icon name="shuffle" size={big ? 20 : 17} />
      </button>

      <button
        type="button"
        className="iconbtn"
        title="Предыдущий трек (P)"
        disabled={!hasQueue}
        onClick={() => usePlayer.getState().previous()}
      >
        <Icon name="previous" size={big ? 24 : 19} />
      </button>

      <button
        type="button"
        className={`transport__play${buffering ? ' transport__play--buffering' : ''}`}
        title={playing ? 'Пауза (Пробел)' : 'Воспроизвести (Пробел)'}
        onClick={() => usePlayer.getState().toggle()}
      >
        <Icon name={playing ? 'pause' : 'play'} size={big ? 26 : 20} />
      </button>

      <button
        type="button"
        className="iconbtn"
        title="Следующий трек (N)"
        disabled={!hasQueue}
        onClick={() => usePlayer.getState().next()}
      >
        <Icon name="next" size={big ? 24 : 19} />
      </button>

      <button
        type="button"
        className={`iconbtn${repeat !== 'off' ? ' iconbtn--active' : ''}`}
        title={repeat === 'one' ? 'Повтор одного трека (R)' : 'Режим повтора (R)'}
        onClick={() => usePlayer.getState().cycleRepeat()}
      >
        <Icon name={repeat === 'one' ? 'repeat-one' : 'repeat'} size={big ? 20 : 17} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Player bar                                                          */
/* ------------------------------------------------------------------ */

export interface PlayerBarProps {
  lyricsOpen: boolean
  queueOpen: boolean
  onToggleLyrics: () => void
  onToggleQueue: () => void
  /** Opens the Now Playing overlay; the shell uses this to close the side docks. */
  onOpenNowPlaying: () => void
}

export function PlayerBar({
  lyricsOpen,
  queueOpen,
  onToggleLyrics,
  onToggleQueue,
  onOpenNowPlaying
}: PlayerBarProps): JSX.Element {
  const currentId = usePlayer((state) => state.currentId)
  const track = useTrack(currentId)
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  const favorite = useIsFavorite(currentId)

  const openNowPlaying = onOpenNowPlaying

  return (
    <footer className="playerbar">
      <div className="playerbar__now">
        <button
          type="button"
          className="playerbar__coverbtn"
          title="Открыть экран воспроизведения"
          disabled={!track}
          onClick={openNowPlaying}
        >
          <Cover src={track?.artwork} alt={track?.title ?? 'Нет трека'} rounded="sm" />
        </button>

        <div className="playerbar__meta">
          <button
            type="button"
            className="playerbar__title"
            title={track?.title ?? ''}
            disabled={!track}
            onClick={openNowPlaying}
          >
            {track?.title ?? 'Ничего не играет'}
          </button>
          <span className="playerbar__artist">{track?.artist ?? 'Выберите трек в каталоге'}</span>
        </div>

        <button
          type="button"
          className={`iconbtn iconbtn--sm playerbar__fav${favorite ? ' iconbtn--active' : ''}`}
          title={favorite ? 'Убрать из избранного (F)' : 'В избранное (F)'}
          disabled={!track}
          onClick={() => {
            if (currentId) void useApp.getState().toggleFavorite(currentId)
          }}
        >
          <Icon name={favorite ? 'heart-filled' : 'heart'} size={17} />
        </button>
      </div>

      <div className="playerbar__center">
        <TransportControls />

        <div className="playerbar__line">
          <span className="playerbar__time">{formatTime(position)}</span>
          <SeekBar
            position={position}
            duration={duration}
            onSeek={(seconds) => usePlayer.getState().seek(seconds)}
          />
          <span className="playerbar__time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="playerbar__right">
        <button
          type="button"
          className={`iconbtn${lyricsOpen ? ' iconbtn--active' : ''}`}
          title="Текст песни (L)"
          onClick={onToggleLyrics}
        >
          <Icon name="lyrics" size={18} />
        </button>
        <button
          type="button"
          className={`iconbtn${queueOpen ? ' iconbtn--active' : ''}`}
          title="Очередь (Q)"
          onClick={onToggleQueue}
        >
          <Icon name="queue" size={18} />
        </button>
        <VolumeBar />
      </div>
    </footer>
  )
}
