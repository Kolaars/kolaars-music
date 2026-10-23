/** Queue-wide playback helpers shared by the views' "play all" affordances. */

import type { Track } from '@shared/types'
import { playableStartIndex, playableTracks } from './external'
import { usePlayer } from '../state/player'
import { useApp } from '../state/store'

function live(tracks: Track[]): Track[] {
  const catalog = useApp.getState().catalogIndex
  return tracks.map((track) => catalog.get(track.id) ?? track)
}

export function playAll(tracks: Track[], startIndex = 0): void {
  const source = live(tracks)
  const playable = playableTracks(source)
  if (playable.length === 0) {
    useApp
      .getState()
      .toast('Сервис не разрешает встраивание этих видео — откройте их в YouTube Music.', 'info')
    return
  }
  usePlayer.getState().playTracks(playable, playableStartIndex(source, playable, startIndex))
}

export function playRandom(tracks: Track[]): void {
  const source = live(tracks)
  const playable = playableTracks(source)
  if (playable.length === 0) {
    useApp
      .getState()
      .toast('Сервис не разрешает встраивание этих видео — откройте их в YouTube Music.', 'info')
    return
  }
  playAll(playable, Math.floor(Math.random() * playable.length))
}

export function shuffleAll(tracks: Track[]): void {
  const source = live(tracks)
  const playable = playableTracks(source)
  if (playable.length === 0) {
    useApp
      .getState()
      .toast('Сервис не разрешает встраивание этих видео — откройте их в YouTube Music.', 'info')
    return
  }
  const player = usePlayer.getState()
  if (!player.shuffle) player.toggleShuffle()
  player.playTracks(playable, Math.floor(Math.random() * playable.length))
}
