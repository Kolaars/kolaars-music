/**
 * Importing a track list from another service.
 *
 * The user pastes (or imports) a list of "Исполнитель — Название" lines and the
 * app resolves each one, in this order:
 *
 *   1. a track already in this profile's library (including local files and
 *      offline downloads) — matched on a normalised artist+title;
 *   2. an item in the open archive (archive.org), when open search is enabled —
 *      accepted only when the title actually matches, so a random result is
 *      never attached to the entry;
 *   3. otherwise the entry is kept as metadata only: a track with names, no
 *      audio. That is the honest outcome for copyrighted music, which has no
 *      legitimate free source — the entry still carries its lyrics.
 *
 * With lyrics enabled, LRCLIB is asked for each resolved track. Nothing is ever
 * taken from a service that forbids it: only open and community sources.
 */

import { createHash } from 'node:crypto'
import {
  matchKey,
  normalizeForMatch,
  titleKey,
  type ImportListEntryResult,
  type ImportListOutcome,
  type ImportListRequest,
  type ImportMatchKind,
  type TrackListEntry
} from '@shared/tracklist'
import type { Lyrics, LyricsCandidate, Track } from '@shared/types'
import * as store from './db'
import { allowMediaPath } from './media'
import { hydrateArchiveTracks, mapLimit, searchArchive } from './providers/archive'
import { lrclibGet, lrclibSearch } from './providers/lyrics'

export type ImportProgressSink = (done: number, total: number, current: string) => void

/** How many entries are resolved at a time (network bound, so keep it small). */
const CONCURRENCY = 3

function listTrackId(artist: string, title: string): string {
  const key = matchKey(artist, title) || title
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 20)
  return `list:${digest}`
}

function lyricsFrom(candidate: LyricsCandidate, trackId: string): Lyrics {
  return {
    trackId,
    plain: candidate.plain ?? '',
    synced: candidate.synced?.length ? candidate.synced : null,
    ...(candidate.meta ? { meta: candidate.meta } : {}),
    origin: 'lrclib',
    provider: candidate.provider ?? 'LRCLIB',
    language: candidate.language ?? null,
    updatedAt: Date.now()
  }
}

/** A local track that can satisfy an entry: on disk, or already downloaded. */
function isPlayableLocal(track: Track): boolean {
  return Boolean(track.filePath) || track.source === 'local'
}

function buildLocalIndex(tracks: Track[]): {
  byKey: Map<string, Track>
  byTitle: Map<string, Track>
} {
  const byKey = new Map<string, Track>()
  const byTitle = new Map<string, Track>()
  for (const track of tracks) {
    if (!isPlayableLocal(track)) continue
    const key = matchKey(track.artist, track.title)
    if (!byKey.has(key)) byKey.set(key, track)
    const tKey = titleKey(track.title)
    if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, track)
  }
  return { byKey, byTitle }
}

/** Scores an archive result against the entry; 0 means "not the same song". */
function archiveScore(track: Track, entry: TrackListEntry): number {
  const title = normalizeForMatch(entry.title)
  const artist = normalizeForMatch(entry.artist)
  if (!title) return 0
  const hitTitle = normalizeForMatch(track.title)
  const hitArtist = normalizeForMatch(track.artist)

  let score = 0
  if (hitTitle === title) score += 5
  else if (hitTitle.includes(title) || title.includes(hitTitle)) score += 3
  else return 0 // the title must line up, or it is somebody else's recording

  if (artist && hitArtist.includes(artist)) score += 2
  if (!track.streamUrl) score -= 1
  return score
}

async function findInArchive(entry: TrackListEntry): Promise<Track | null> {
  const query = [entry.artist, entry.title].filter(Boolean).join(' ')
  if (!query) return null
  try {
    const page = await searchArchive({ text: query, pageSize: 8 })
    if (page.items.length === 0) return null
    const hydrated = await hydrateArchiveTracks(page.items, false)
    let best: { track: Track; score: number } | null = null
    for (const track of hydrated) {
      const score = archiveScore(track, entry)
      if (score > 0 && (!best || score > best.score)) best = { track, score }
    }
    return best?.track ?? null
  } catch {
    // Offline or rate limited: the entry still resolves to metadata only.
    return null
  }
}

async function findLyrics(track: Track): Promise<Lyrics | null> {
  if (!track.artist && !track.title) return null
  const exact = await lrclibGet(track.artist, track.title, track.duration ?? null)
  if (exact) return lyricsFrom(exact, track.id)
  const fuzzy = await lrclibSearch(track.artist, track.title, track.duration ?? null)
  const best = fuzzy.find((candidate) => candidate.score > 0) ?? fuzzy[0]
  return best ? lyricsFrom(best, track.id) : null
}

function uniqueEntries(entries: TrackListEntry[]): TrackListEntry[] {
  const seen = new Set<string>()
  const out: TrackListEntry[] = []
  for (const entry of entries) {
    const title = String(entry?.title ?? '').trim()
    if (!title) continue
    const artist = String(entry?.artist ?? '').trim()
    const key = matchKey(artist, title)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ artist, title, raw: entry.raw ?? `${artist} — ${title}` })
  }
  return out
}

/**
 * Resolves and stores a list of entries. Writes the library once, at the end,
 * so a slow archive lookup cannot leave the profile half-imported.
 */
export async function importTrackList(
  request: ImportListRequest,
  onProgress: ImportProgressSink = () => {}
): Promise<ImportListOutcome> {
  const startedAt = Date.now()
  const entries = uniqueEntries(request.entries ?? [])
  const db = await store.loadDb()
  const settings = db.settings

  const canSearchArchive =
    request.searchArchive && settings.onlineProviders && settings.providers.archive
  const canFetchLyrics = request.fetchLyrics && settings.onlineProviders && settings.providers.lrclib

  const { byKey, byTitle } = buildLocalIndex(Object.values(db.tracks))

  let done = 0
  onProgress(0, entries.length, '')

  const resolved = await mapLimit(entries, CONCURRENCY, async (entry) => {
    let track: Track | null = null
    let match: ImportMatchKind = 'metadata'

    const local = byKey.get(matchKey(entry.artist, entry.title))
    const localByTitle = entry.artist ? undefined : byTitle.get(titleKey(entry.title))
    const hit = local ?? localByTitle

    if (hit) {
      track = hit
      match = 'local'
    } else if (canSearchArchive) {
      const found = await findInArchive(entry)
      if (found) {
        track = found
        match = 'archive'
      }
    }

    if (!track) {
      track = {
        id: listTrackId(entry.artist, entry.title),
        title: entry.title,
        artist: entry.artist,
        album: null,
        year: null,
        duration: null,
        source: 'list',
        // No audio: this entry exists so its names and lyrics are searchable.
        streamUrl: '',
        addedAt: Date.now()
      }
    }

    done += 1
    onProgress(done, entries.length, entry.title)

    return { entry, track, match }
  })

  /* Lyrics, in a second pass so archive lookups are not delayed by them. */
  const lyricsByTrack = new Map<string, Lyrics>()
  if (canFetchLyrics) {
    const targets = resolved
      .map((item) => item.track)
      .filter((track, index, all) => all.findIndex((t) => t.id === track.id) === index)
      .filter((track) => !db.lyrics[track.id])

    await mapLimit(targets, CONCURRENCY, async (track) => {
      const lyrics = await findLyrics(track)
      if (lyrics) lyricsByTrack.set(track.id, lyrics)
    })
  }

  /* One write for the whole import. */
  await store.updateDb((doc) => {
    for (const { track, match } of resolved) {
      const existing = doc.tracks[track.id]
      if (match === 'metadata' && existing) continue // keep whatever the user has
      if (match === 'local' && existing) {
        // Already known: nothing to change, but make sure local files stay playable.
        if (existing.filePath) allowMediaPath(existing.filePath)
        continue
      }
      doc.tracks[track.id] = { ...existing, ...track, addedAt: existing?.addedAt ?? track.addedAt }
      if (track.filePath) allowMediaPath(track.filePath)
    }
    for (const lyrics of lyricsByTrack.values()) doc.lyrics[lyrics.trackId] = lyrics
  })

  const results: ImportListEntryResult[] = resolved.map(({ entry, track, match }) => ({
    raw: entry.raw,
    artist: entry.artist,
    title: entry.title,
    trackId: track.id,
    match,
    matchedTitle: track.title,
    lyrics: !canFetchLyrics ? 'skipped' : lyricsByTrack.has(track.id) ? 'saved' : 'none'
  }))

  return {
    results,
    trackIds: results.map((result) => result.trackId),
    stats: {
      total: results.length,
      local: results.filter((r) => r.match === 'local').length,
      archive: results.filter((r) => r.match === 'archive').length,
      metadata: results.filter((r) => r.match === 'metadata').length,
      lyrics: lyricsByTrack.size
    },
    durationMs: Date.now() - startedAt
  }
}
