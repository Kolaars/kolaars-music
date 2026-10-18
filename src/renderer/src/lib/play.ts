/** Queue-wide playback helpers shared by the views' "play all" affordances. */

import type { Track } from '@shared/types'
import { usePlayer } from '../state/player'

export function playAll(tracks: Track[], startIndex = 0): void {
  if (tracks.length === 0) return
  usePlayer.getState().playTracks(tracks, startIndex)
}

export function playRandom(tracks: Track[]): void {
  if (tracks.length === 0) return
  playAll(tracks, Math.floor(Math.random() * tracks.length))
}

export function shuffleAll(tracks: Track[]): void {
  if (tracks.length === 0) return
  const player = usePlayer.getState()
  if (!player.shuffle) player.toggleShuffle()
  player.playTracks(tracks, Math.floor(Math.random() * tracks.length))
}
