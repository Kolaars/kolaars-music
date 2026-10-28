/** Genre derivation shared by the desktop and Android catalog screens. */

import type { Track } from './types'

const GENRE_STOPWORDS = new Set([
  'music',
  'sound',
  'audio',
  '78 rpm',
  '78rpm',
  'shellac',
  'vinyl',
  'series',
  'collection',
  'the great 78 project',
  'netlabels',
  'musopen'
])

/** Distinct, human-useful genre tags taken from a catalog. */
export function deriveGenres(tracks: Track[], limit = 24): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const track of tracks) {
    for (const raw of track.genres ?? []) {
      const genre = raw.trim()
      if (!genre || genre.length > 40) continue
      if (GENRE_STOPWORDS.has(genre.toLowerCase())) continue
      if (/^\d+$/.test(genre)) continue
      const key = genre.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ name: key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
