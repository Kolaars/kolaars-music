/**
 * Bridges the player to the OS media controls (Windows SMTC, media keys).
 *
 * Metadata is only pushed when the track changes and the position is sampled
 * once a second — MediaSession is a system boundary, so we keep writes cheap.
 */

import { useEffect } from 'react'
import type { Track } from '@shared/types'
import { usePlayer } from '../state/player'

function artwork(track: Track): MediaImage[] {
  if (!track.artwork) return []
  return [{ src: track.artwork, sizes: '512x512', type: 'image/jpeg' }]
}

export function useMediaSession(track: Track | null): void {
  const playing = usePlayer((state) => state.playing)
  const trackId = track?.id ?? null

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    if (!track) {
      session.metadata = null
      return
    }
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? 'Kolaars Music',
      artwork: artwork(track)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId])

  useEffect(() => {
    const session = navigator.mediaSession
    if (session) session.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return

    const player = usePlayer.getState()
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => player.play()],
      ['pause', () => player.pause()],
      ['stop', () => player.stop()],
      ['previoustrack', () => player.previous()],
      ['nexttrack', () => player.next()],
      ['seekbackward', (details) => player.skip(-(details.seekOffset ?? 10))],
      ['seekforward', (details) => player.skip(details.seekOffset ?? 10)],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') player.seek(details.seekTime)
        }
      ]
    ]

    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        /* action not supported by this platform */
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session?.setPositionState) return

    const id = window.setInterval(() => {
      const { position, duration, playing: isPlaying } = usePlayer.getState()
      if (!isPlaying || !Number.isFinite(duration) || duration <= 0) return
      try {
        session.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.max(0, Math.min(position, duration))
        })
      } catch {
        /* the platform rejected the state (e.g. position > duration) */
      }
    }, 1000)

    return () => window.clearInterval(id)
  }, [])
}
