/** The catalog shipped inside the APK, so a fresh install has something to play offline. */

import raw from '@data/seed-catalog.json'
import type { Track } from '@shared/types'

interface SeedFile {
  trackCount?: number
  tracks?: Track[]
}

const file = raw as unknown as SeedFile

export const SEED_TRACKS: Track[] = (file.tracks ?? []).map((track) => ({
  ...track,
  source: 'seed' as const
}))

export const SEED_COUNT = SEED_TRACKS.length

/** A shelf clue stored on seed tracks by the generator, if present. */
export function shelfOf(track: Track): string | null {
  const value = (track as Track & { shelf?: string }).shelf
  return typeof value === 'string' ? value : null
}
