/** Helpers for tracks that are played by a provider's official embedded player. */

import type { Track } from '@shared/types'
import { externalOpenUrl } from '@shared/external'
import { api } from './api'

export { externalOpenUrl } from '@shared/external'

/** The provider explicitly refused to embed this item. */
export function isExternalBlocked(track: Track): boolean {
  return track.external?.embeddable === false
}

export function openExternalTrack(track: Track): void {
  const url = externalOpenUrl(track)
  if (url) void api.app.openExternal(url)
}

/** Drops items the official player will refuse before they enter a queue. */
export function playableTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => !isExternalBlocked(track))
}

/** Maps a row index onto the filtered list, skipping blocked items. */
export function playableStartIndex(
  source: Track[],
  playable: Track[],
  startIndex: number
): number {
  const requested = source[Math.max(0, Math.min(startIndex, source.length - 1))]
  if (requested && !isExternalBlocked(requested)) {
    const exact = playable.indexOf(requested)
    if (exact >= 0) return exact
  }

  for (let index = startIndex; index < source.length; index++) {
    const candidate = source[index]
    if (candidate && !isExternalBlocked(candidate)) {
      const next = playable.indexOf(candidate)
      if (next >= 0) return next
    }
  }
  return 0
}
