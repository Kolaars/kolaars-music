/**
 * Embedded provider player.
 *
 * YouTube and SoundCloud both publish an official embeddable player. This
 * component mounts that player in a visible card and drives it through its
 * public JavaScript API — play, pause, seek and volume. The audio never passes
 * through the app, and the player is never hidden: keeping it on screen is
 * part of the providers' terms.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ExternalRef, Track } from '@shared/types'
import { externalOpenUrl, isExternalBlocked } from '../lib/external'
import { useApp } from '../state/store'
import {
  consumeExternalAutoplay,
  registerExternalController,
  usePlayer,
  type ExternalController
} from '../state/player'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ */
/* Provider API typings (the official scripts have none)               */
/* ------------------------------------------------------------------ */

interface YouTubePlayer {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (percent: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  destroy: () => void
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      width?: string
      height?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onStateChange?: (event: { data: number }) => void
        onError?: (event: { data: number }) => void
      }
    }
  ) => YouTubePlayer
}

interface SoundCloudWidget {
  bind: (event: string, callback: () => void) => void
  play: () => void
  pause: () => void
  seekTo: (milliseconds: number) => void
  setVolume: (volume: number) => void
  getDuration: (callback: (milliseconds: number) => void) => void
  getPosition: (callback: (milliseconds: number) => void) => void
}

interface SoundCloudNamespace {
  Widget: ((frame: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: Record<'READY' | 'PLAY' | 'PAUSE' | 'FINISH' | 'ERROR', string>
  }
}

type ProviderGlobals = Window & {
  YT?: YouTubeNamespace
  SC?: SoundCloudNamespace
  onYouTubeIframeAPIReady?: () => void
}

/* ------------------------------------------------------------------ */
/* Script loaders                                                      */
/* ------------------------------------------------------------------ */

let youtubeApi: Promise<YouTubeNamespace> | null = null
let soundCloudApi: Promise<SoundCloudNamespace> | null = null

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  const scope = window as ProviderGlobals
  if (scope.YT?.Player) return Promise.resolve(scope.YT)
  if (youtubeApi) return youtubeApi

  youtubeApi = new Promise<YouTubeNamespace>((resolve, reject) => {
    let settled = false
    const finish = (api: YouTubeNamespace): void => {
      if (settled) return
      settled = true
      resolve(api)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      youtubeApi = null
      reject(error)
    }

    const previous = scope.onYouTubeIframeAPIReady
    scope.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (scope.YT?.Player) finish(scope.YT)
    }

    if (!document.getElementById('kolaars-youtube-api')) {
      const script = document.createElement('script')
      script.id = 'kolaars-youtube-api'
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.onerror = () => fail(new Error('Не удалось загрузить YouTube IFrame API'))
      document.head.appendChild(script)
    }

    const poll = window.setInterval(() => {
      if (scope.YT?.Player) {
        window.clearInterval(poll)
        finish(scope.YT)
      }
    }, 200)
    window.setTimeout(() => {
      window.clearInterval(poll)
      if (!settled) fail(new Error('YouTube IFrame API не ответил за 20 секунд'))
    }, 20_000)
  })

  return youtubeApi
}

function loadSoundCloudApi(): Promise<SoundCloudNamespace> {
  const scope = window as ProviderGlobals
  if (scope.SC?.Widget) return Promise.resolve(scope.SC)
  if (soundCloudApi) return soundCloudApi

  soundCloudApi = new Promise<SoundCloudNamespace>((resolve, reject) => {
    let settled = false
    const finish = (api: SoundCloudNamespace): void => {
      if (settled) return
      settled = true
      resolve(api)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      soundCloudApi = null
      reject(error)
    }

    if (!document.getElementById('kolaars-soundcloud-api')) {
      const script = document.createElement('script')
      script.id = 'kolaars-soundcloud-api'
      script.src = 'https://w.soundcloud.com/player/api.js'
      script.async = true
      script.onerror = () => fail(new Error('Не удалось загрузить SoundCloud Widget API'))
      document.head.appendChild(script)
    }

    const poll = window.setInterval(() => {
      if (scope.SC?.Widget) {
        window.clearInterval(poll)
        finish(scope.SC)
      }
    }, 200)
    window.setTimeout(() => {
      window.clearInterval(poll)
      if (!settled) fail(new Error('SoundCloud Widget API не ответил за 20 секунд'))
    }, 20_000)
  })

  return soundCloudApi
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function ExternalPlayer(): JSX.Element | null {
  const external = usePlayer((state) => state.external)
  const currentId = usePlayer((state) => state.currentId)
  const nowPlaying = useApp((state) => state.nowPlayingOpen)
  const track = useApp((state) => (currentId ? state.catalogIndex.get(currentId) : undefined))

  // `markExternalBlocked` normally keeps such a track out of the player
  // state; this is a second line of defence for restored or stale sessions.
  // The card itself still renders for a blocked item so it can offer the
  // "open in the service" fallback.
  if (!external || !track) return null

  return (
    <ExternalCard
      // A new key per item guarantees the old provider player is destroyed
      // before the next one is created.
      key={`${external.provider}:${external.id}`}
      track={track}
      external={external}
      elevated={nowPlaying}
    />
  )
}

function ExternalCard({
  track,
  external,
  elevated
}: {
  track: Track
  external: ExternalRef
  elevated: boolean
}): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const blocked = isExternalBlocked(track) || external.embeddable === false
  const service = external.provider === 'youtube' ? 'YouTube Music' : 'SoundCloud'
  const item = external.provider === 'youtube' ? 'это видео' : 'этот трек'

  const handleReady = useCallback(() => setReady(true), [])
  const handleError = useCallback(
    (message: string | null, block = false) => {
      setError(message)
      if (!block) return
      // The provider's API said the item was embeddable, but its own player
      // rejected it (age gate, licensing, region). Remember that so the row
      // offers the external fallback next time instead of failing again.
      useApp.getState().markExternalUnplayable(track.id)
      usePlayer.getState().externalReport(external.id, { playing: false })
    },
    [track.id, external.id]
  )

  const openExternal = (): void => {
    void window.kolaars.app.openExternal(externalOpenUrl(track) ?? external.pageUrl)
  }

  return (
    <aside
      className={`externalplayer${elevated ? ' externalplayer--elevated' : ''}`}
      aria-label="Официальный плеер сервиса"
    >
      <header className="externalplayer__head">
        <span className="externalplayer__badge">
          <Icon name="external" size={12} />
          {external.provider === 'youtube' ? 'YouTube' : 'SoundCloud'}
        </span>
        <button type="button" className="externalplayer__link" onClick={openExternal}>
          Открыть в {service}
        </button>
      </header>

      {!blocked ? (
        <div className="externalplayer__stage">
          {!ready && !error ? (
            <span className="externalplayer__loading">Загружаем плеер…</span>
          ) : null}
          {external.provider === 'youtube' ? (
            <YouTubeStage external={external} onReady={handleReady} onError={handleError} />
          ) : (
            <SoundCloudStage external={external} onReady={handleReady} onError={handleError} />
          )}
        </div>
      ) : null}

      <div className="externalplayer__meta" title={`${track.artist} — ${track.title}`}>
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </div>

      {blocked ? (
        <div className="externalplayer__blocked">
          <Icon name="alert" size={18} />
          <p>
            Сервис не разрешает встраивание. Откройте {item} в {service}.
          </p>
          <button type="button" className="btn btn--primary btn--sm" onClick={openExternal}>
            Открыть в {service}
          </button>
        </div>
      ) : error ? (
        <p className="externalplayer__error">
          {error}
          <button type="button" onClick={openExternal}>
            Открыть в {service}
          </button>
        </p>
      ) : null}
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

function YouTubeStage({
  external,
  onReady,
  onError
}: {
  external: ExternalRef
  onReady: () => void
  onError: (message: string | null, block?: boolean) => void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let player: YouTubePlayer | null = null
    let poll = 0

    const report = (): void => {
      if (!player) return
      usePlayer.getState().externalReport(external.id, {
        position: player.getCurrentTime(),
        duration: player.getDuration()
      })
    }

    void loadYouTubeApi()
      .then((YT) => {
        if (disposed || !host.current) return
        player = new YT.Player(host.current, {
          videoId: external.id,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3
          },
          events: {
            onReady: () => {
              if (disposed || !player) return
              const state = usePlayer.getState()
              const volume = state.muted ? 0 : Math.round(state.volume * 100)
              player.setVolume(volume)
              usePlayer.getState().markExternalReady(external.id)
              onReady()

              if (consumeExternalAutoplay()) player.playVideo()
              else if (state.position > 0) player.seekTo(state.position, true)

              poll = window.setInterval(report, 500)
            },
            onStateChange: (event) => {
              if (event.data === 1) {
                usePlayer.getState().externalReport(external.id, { playing: true })
              } else if (event.data === 2) {
                usePlayer.getState().externalReport(external.id, { playing: false })
              } else if (event.data === 0) {
                usePlayer.getState().externalReport(external.id, { playing: false })
                usePlayer.getState().externalEnded()
              }
            },
            onError: (event) => {
              const code = event?.data
              if (code === 101 || code === 150) {
                onError('YouTube не разрешил встраивание этого видео.', true)
              } else if (code === 100) {
                onError('Видео недоступно: удалено, приватное или ограничено.')
              } else {
                onError('YouTube не смог воспроизвести это видео.')
              }
            }
          }
        })

        const controller: ExternalController = {
          play: () => player?.playVideo(),
          pause: () => player?.pauseVideo(),
          seek: (seconds) => player?.seekTo(seconds, true),
          setVolume: (volume) => player?.setVolume(Math.round(volume * 100))
        }
        registerExternalController(controller)
      })
      .catch((reason: unknown) => {
        if (!disposed) onError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      disposed = true
      window.clearInterval(poll)
      registerExternalController(null)
      try {
        player?.destroy()
      } catch {
        /* the iframe may already be gone */
      }
      player = null
    }
    // The card is keyed by provider+id, so these never change while mounted.
  }, [external.id, onError, onReady])

  return (
    <div className="externalplayer__frame externalplayer__frame--video">
      {/* The IFrame API replaces this inner node with its own iframe, while
          React keeps ownership of the outer wrapper. */}
      <div ref={host} className="externalplayer__youtube" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* SoundCloud                                                          */
/* ------------------------------------------------------------------ */

function SoundCloudStage({
  external,
  onReady,
  onError
}: {
  external: ExternalRef
  onReady: () => void
  onError: (message: string | null) => void
}): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)

  const src =
    'https://w.soundcloud.com/player/?url=' +
    encodeURIComponent(external.pageUrl) +
    '&color=%237c5cff&auto_play=false&hide_related=true&show_comments=false' +
    '&show_user=true&show_reposts=false&show_teaser=false&visual=false'

  useEffect(() => {
    let disposed = false
    let widget: SoundCloudWidget | null = null
    let poll = 0

    const attach = async (): Promise<void> => {
      const SC = await loadSoundCloudApi()
      if (disposed || !frame.current) return

      widget = SC.Widget(frame.current)
      registerExternalController({
        play: () => widget?.play(),
        pause: () => widget?.pause(),
        seek: (seconds) => widget?.seekTo(seconds * 1000),
        setVolume: (volume) => widget?.setVolume(Math.round(volume * 100))
      })

      widget.bind(SC.Widget.Events.READY, () => {
        if (disposed || !widget) return
        const state = usePlayer.getState()
        widget.setVolume(state.muted ? 0 : Math.round(state.volume * 100))
        widget.getDuration((milliseconds) => {
          usePlayer.getState().externalReport(external.id, { duration: milliseconds / 1000 })
        })
        usePlayer.getState().markExternalReady(external.id)
        onReady()

        if (consumeExternalAutoplay()) widget.play()
        else if (state.position > 0) widget.seekTo(state.position * 1000)

        poll = window.setInterval(() => {
          widget?.getPosition((milliseconds) => {
            usePlayer.getState().externalReport(external.id, { position: milliseconds / 1000 })
          })
        }, 500)
      })

      widget.bind(SC.Widget.Events.PLAY, () =>
        usePlayer.getState().externalReport(external.id, { playing: true })
      )
      widget.bind(SC.Widget.Events.PAUSE, () =>
        usePlayer.getState().externalReport(external.id, { playing: false })
      )
      widget.bind(SC.Widget.Events.FINISH, () => {
        usePlayer.getState().externalReport(external.id, { playing: false })
        usePlayer.getState().externalEnded()
      })
      widget.bind(SC.Widget.Events.ERROR, () =>
        onError('SoundCloud не разрешил воспроизведение этого трека')
      )
    }

    void attach().catch((reason: unknown) => {
      if (!disposed) onError(reason instanceof Error ? reason.message : String(reason))
    })

    return () => {
      disposed = true
      window.clearInterval(poll)
      registerExternalController(null)
      widget = null
    }
  }, [external.id, external.pageUrl, onError, onReady])

  return (
    <iframe
      ref={frame}
      className="externalplayer__frame externalplayer__frame--widget"
      title="SoundCloud"
      src={src}
      allow="autoplay"
      loading="eager"
    />
  )
}
