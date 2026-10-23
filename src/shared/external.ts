/** Pure link helpers for tracks played by an external provider's player. */

import type { Track } from './types'

/**
 * Public page for an external track.
 *
 * YouTube's iframe target is a normal watch page, but the app presents the
 * service as YouTube Music: `music.youtube.com` opens the same video there.
 */
export function externalOpenUrl(track: Track): string | null {
  const external = track.external
  if (!external) return null
  if (external.provider === 'youtube') {
    return `https://music.youtube.com/watch?v=${encodeURIComponent(external.id)}`
  }
  return external.pageUrl
}

/**
 * Public YouTube Music search for a track that exists only on disk.
 *
 * A local file has no public page a Discord button could open, but searching
 * the official service by artist and title is a real destination. It is a
 * search, not a claim that the same recording is available there.
 */
export function youtubeMusicSearchUrl(query: string): string | null {
  const trimmed = query.trim()
  if (!trimmed) return null
  return `https://music.youtube.com/search?q=${encodeURIComponent(trimmed)}`
}
