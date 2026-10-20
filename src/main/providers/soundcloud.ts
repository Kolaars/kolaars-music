/**
 * SoundCloud search through the official public API.
 *
 * Playback uses the official SoundCloud Widget: the app embeds the widget and
 * drives it through `w.soundcloud.com/player/api.js`. It never resolves or
 * downloads the underlying audio stream.
 *
 * New SoundCloud applications are reviewed manually; a `client_id` issued to an
 * approved app is required. When the API rejects it, the UI says so instead of
 * silently returning nothing.
 */

import { fetchJson } from '../http'
import type { SearchResultPage, SourceSearchQuery, Track } from '@shared/types'

const API = 'https://api.soundcloud.com'

interface SoundCloudUser {
  username?: string
  permalink_url?: string
}

interface SoundCloudTrack {
  id?: number
  title?: string
  duration?: number
  artwork_url?: string | null
  permalink_url?: string
  streamable?: boolean
  policy?: string
  genre?: string
  created_at?: string
  user?: SoundCloudUser
}

interface SoundCloudCollection {
  collection?: SoundCloudTrack[]
  next_href?: string | null
}

/** `/tracks` returns a bare array, but paged endpoints return a collection. */
type SoundCloudList = SoundCloudTrack[] | SoundCloudCollection

function itemsOf(data: SoundCloudList): SoundCloudTrack[] {
  if (Array.isArray(data)) return data
  return data.collection ?? []
}

function artwork(url: string | null | undefined): string | null {
  if (!url) return null
  // SoundCloud returns `...-large.jpg`; request a sharper rendition when the
  // pattern is the usual one, otherwise keep what the API gave us.
  return url.replace(/-large\.(jpg|png)$/i, '-t500x500.$1')
}

function trackFromApi(track: SoundCloudTrack): Track | null {
  const numericId = track.id
  if (numericId == null || !track.permalink_url) return null
  if (track.streamable === false || track.policy === 'BLOCK' || track.policy === 'SNIP') return null

  const year = track.created_at ? Number(track.created_at.slice(0, 4)) || null : null

  return {
    id: `sc:${numericId}`,
    title: (track.title ?? '').trim() || `SoundCloud ${numericId}`,
    artist: track.user?.username?.trim() || 'SoundCloud',
    album: null,
    year,
    genres: track.genre ? [track.genre] : [],
    duration: track.duration ? Math.round(track.duration / 1000) : null,
    artwork: artwork(track.artwork_url),
    source: 'external',
    streamUrl: '',
    identifier: String(numericId),
    external: {
      provider: 'soundcloud',
      id: String(numericId),
      pageUrl: track.permalink_url
    },
    filePath: null,
    license: null,
    licenseUrl: null,
    sourceUrl: track.permalink_url,
    offline: false,
    addedAt: null
  }
}

function friendlyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/HTTP (401|403)/.test(message)) {
    throw new Error(
      'SoundCloud отклонил client_id. Проверьте, что приложение одобрено, и вставьте ключ заново.'
    )
  }
  if (/HTTP 404/.test(message)) throw new Error('SoundCloud не нашёл этот трек')
  throw error instanceof Error ? error : new Error(message)
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function searchSoundCloud(
  clientId: string,
  query: SourceSearchQuery
): Promise<SearchResultPage<Track>> {
  const text = query.text.trim()
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 24))
  if (!text) return { items: [], page, pageSize, total: 0, hasMore: false }

  const params = new URLSearchParams({
    q: text,
    client_id: clientId,
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
    linked_partitioning: '1'
  })

  let data: SoundCloudList
  try {
    data = await fetchJson<SoundCloudList>(`${API}/tracks?${params}`, { timeoutMs: 25_000 })
  } catch (error) {
    friendlyError(error)
  }

  const raw = itemsOf(data)
  const items = raw
    .map(trackFromApi)
    .filter((track): track is Track => Boolean(track))

  const collection = Array.isArray(data) ? undefined : data
  return {
    items,
    page,
    pageSize,
    total: (page - 1) * pageSize + items.length,
    hasMore: Boolean(collection?.next_href) || raw.length >= pageSize
  }
}

/** Loads one track by id — used to restore saved tracks and old queues. */
export async function fetchSoundCloudTrack(clientId: string, trackId: string): Promise<Track | null> {
  const id = String(trackId ?? '').trim()
  if (!/^\d+$/.test(id)) return null
  try {
    const data = await fetchJson<SoundCloudTrack>(
      `${API}/tracks/${encodeURIComponent(id)}?${new URLSearchParams({ client_id: clientId })}`,
      { timeoutMs: 25_000 }
    )
    return trackFromApi(data)
  } catch (error) {
    friendlyError(error)
  }
}
