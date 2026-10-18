/**
 * The bundled public-domain lyrics pack.
 *
 * `data/lyrics-pack.json` is compiled into the app, so it works offline and
 * needs no filesystem lookup. Matching is intentionally forgiving: archive
 * titles are messy ("DANNY BOY - ART TATUM - Tatum", "St. Louis Blues (Take 2)")
 * and we still want to find the right text.
 */

import packRaw from '../../../data/lyrics-pack.json'
import type { Lyrics, Track } from '@shared/types'

interface PackSong {
  id: string
  title: string
  aliases?: string[]
  artist: string
  year?: number
  language?: string
  lyrics: string[] | string
}

interface PackFile {
  name: string
  version: string
  license: string
  note: string
  songs: PackSong[]
}

const pack = packRaw as unknown as PackFile

export interface BundledSong {
  id: string
  title: string
  artist: string
  year?: number
  language?: string
  license: string
}

interface IndexedSong extends PackSong {
  _plain: string
  _keys: string[]
}

/** Removes diacritics so "Noël" matches "Noel". */
function foldDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const NOISE_SUFFIXES =
  /\b(remaster(ed)?|restored|take \d+|part \d+|version|mix|mono|stereo|reprise|instrumental|alternate|alt\.?)\b/g

export function normalizeTitle(input: string): string {
  let s = foldDiacritics(String(input ?? '').toLowerCase())
  s = s.replace(/&/g, ' and ')
  // Drop bracketed asides such as "(1932 recording)" or "[Take 2]".
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ')
  // Drop the trailing "- artist - composer" chain archive.org likes to append.
  s = s.replace(/\s[-–—]\s.*$/, ' ')
  s = s.replace(NOISE_SUFFIXES, ' ')
  s = s.replace(/[^\p{L}\p{N}\s']/gu, ' ')
  s = s.replace(/'/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^the\s+/, '')
  return s
}

const index = new Map<string, IndexedSong[]>()
const byId = new Map<string, IndexedSong>()

function addToIndex(key: string, song: IndexedSong): void {
  const existing = index.get(key)
  if (existing) {
    if (!existing.includes(song)) existing.push(song)
  } else {
    index.set(key, [song])
  }
}

for (const raw of pack.songs) {
  const plain = Array.isArray(raw.lyrics) ? raw.lyrics.join('\n') : String(raw.lyrics ?? '')
  const song: IndexedSong = { ...raw, _plain: plain.trimEnd(), _keys: [] }
  const keys = new Set<string>()
  for (const candidate of [raw.title, ...(raw.aliases ?? [])]) {
    const key = normalizeTitle(candidate)
    if (key.length >= 4) keys.add(key)
  }
  song._keys = Array.from(keys)
  for (const key of song._keys) addToIndex(key, song)
  byId.set(raw.id, song)
}

export const PACK_INFO = {
  name: pack.name,
  version: pack.version,
  license: pack.license,
  note: pack.note,
  count: pack.songs.length
}

export function listBundledSongs(): BundledSong[] {
  return pack.songs.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    year: song.year,
    language: song.language,
    license: pack.license
  }))
}

export function getBundledSong(id: string): BundledSong | null {
  const song = byId.get(id)
  if (!song) return null
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    year: song.year,
    language: song.language,
    license: pack.license
  }
}

function toLyrics(song: IndexedSong, trackId: string): Lyrics {
  return {
    trackId,
    plain: song._plain,
    synced: null,
    meta: {
      ti: song.title,
      ar: song.artist,
      ...(song.year ? { year: String(song.year) } : {})
    },
    origin: 'pack',
    provider: `${pack.name} v${pack.version}`,
    language: song.language ?? null,
    updatedAt: Date.now()
  }
}

export function bundledLyricsById(songId: string, trackId: string): Lyrics | null {
  const song = byId.get(songId)
  return song ? toLyrics(song, trackId) : null
}

/**
 * Finds the best bundled lyrics for a track.
 *
 * Strategy, in order:
 *  1. exact normalised title match
 *  2. longest normalised pack title contained in the track title (word-boundary),
 *     requiring >= 8 characters so short titles do not match everything
 *  3. same as (2) but against the "artist — title" string
 */
export function findBundledLyrics(track: Pick<Track, 'id' | 'title' | 'artist'>): Lyrics | null {
  const candidates: string[] = [
    normalizeTitle(track.title),
    normalizeTitle(`${track.artist} ${track.title}`)
  ].filter(Boolean)

  for (const candidate of candidates) {
    const exact = index.get(candidate)
    if (exact?.length) {
      const best = pickBest(exact, track.artist)
      return toLyrics(best, track.id)
    }
  }

  let bestSong: IndexedSong | null = null
  let bestLength = 0

  for (const candidate of candidates) {
    const padded = ` ${candidate} `
    for (const [key, songs] of index) {
      if (key.length < 8) continue
      if (!padded.includes(` ${key} `)) continue
      if (key.length > bestLength) {
        bestLength = key.length
        bestSong = pickBest(songs, track.artist)
      }
    }
  }

  return bestSong ? toLyrics(bestSong, track.id) : null
}

function pickBest(songs: IndexedSong[], artist: string | undefined): IndexedSong {
  if (songs.length === 1) return songs[0]
  const artistKey = normalizeTitle(artist ?? '')
  if (artistKey) {
    const byArtist = songs.find((song) => {
      const songArtist = normalizeTitle(song.artist)
      return songArtist && (artistKey.includes(songArtist) || songArtist.includes(artistKey))
    })
    if (byArtist) return byArtist
  }
  // Prefer the song with the most text — usually the fullest transcription.
  return songs.reduce((acc, song) => (song._plain.length > acc._plain.length ? song : acc))
}

/** Free-text search across the pack, used by the lyrics picker in the UI. */
export function searchBundledSongs(query: string, limit = 25): BundledSong[] {
  const needle = normalizeTitle(query)
  if (!needle) return listBundledSongs().slice(0, limit)
  const scored: { song: PackSong; score: number }[] = []
  for (const song of pack.songs) {
    const haystack = normalizeTitle(`${song.title} ${song.artist} ${(song.aliases ?? []).join(' ')}`)
    let score = 0
    if (haystack === needle) score = 100
    else if (haystack.includes(needle)) score = 60 - Math.min(30, haystack.indexOf(needle))
    else if (needle.split(' ').every((word) => haystack.includes(word))) score = 30
    if (score > 0) scored.push({ song, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title))
    .slice(0, limit)
    .map(({ song }) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      year: song.year,
      language: song.language,
      license: pack.license
    }))
}
