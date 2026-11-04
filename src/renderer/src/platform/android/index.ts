/**
 * The Android implementation of `KolaarsApi`.
 *
 * The React screens are shared with the desktop build, so this module has to
 * provide the same behaviour without Node, Electron or the `kmedia://` scheme.
 * Storage is a JSON document in the app's private folder (`storage.ts`), the
 * online providers are the platform-neutral ones from `src/shared`, and the
 * superpowers the desktop gets from Electron (local files, downloads, Discord)
 * are either implemented natively later or reported as unavailable here.
 */

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type {
  AppInfo,
  DownloadRecord,
  ImportOutcome,
  KolaarsApi,
  LibrarySnapshot,
  ProfilesState,
  ShelfDescriptor
} from '@shared/api'
import {
  ARCHIVE_COLLECTIONS,
  SHELVES,
  fetchArchiveItem,
  hydrateArchiveTracks,
  resolveArchiveTrack,
  searchArchive
} from '@shared/archive'
import { makeId } from '@shared/defaults'
import { deriveGenres } from '@shared/genres'
import { distributeTimings } from '@shared/lrc'
import {
  PACK_INFO,
  bundledLyricsById,
  findBundledLyrics,
  listBundledSongs,
  searchBundledSongs
} from '@shared/lyrics-pack'
import { lrclibGet, lrclibSearch, wikisourceFetch, wikisourceSearch } from '@shared/lyrics-online'
import { matchKey, normalizeForMatch, titleKey } from '@shared/tracklist'
import type {
  ImportListEntryResult,
  ImportListOutcome,
  ImportListRequest,
  PlaylistFileFormat,
  TrackListEntry
} from '@shared/tracklist'
import type {
  ArchiveCollection,
  DiscordPresence,
  DiscordRpcStatus,
  ExternalProvider,
  Lyrics,
  LyricsCandidate,
  Playlist,
  SearchQuery,
  SearchResultPage,
  Settings,
  SessionState,
  SourceSearchQuery,
  SourcesStatus,
  Track
} from '@shared/types'
import {
  deleteCopiedFile,
  exportLyrics,
  exportPlaylist,
  importHandles,
  importLyrics,
  localArtworkPath,
  pickFiles,
  pickFolder,
  pickTextFile
} from './local'
import { SEED_COUNT, SEED_TRACKS, shelfOf } from './seed'
import * as store from './storage'
import { t } from '../../lib/i18n'

/* ------------------------------------------------------------------ */
/* Tiny event bus                                                      */
/* ------------------------------------------------------------------ */

type ImportProgress = { done: number; total: number; current: string }
const importListeners = new Set<(progress: ImportProgress) => void>()
const downloadListeners = new Set<(record: DownloadRecord) => void>()

function emitImport(progress: ImportProgress): void {
  for (const listener of importListeners) listener(progress)
}

function emitDownload(record: DownloadRecord): void {
  for (const listener of downloadListeners) listener(record)
}

/* ------------------------------------------------------------------ */
/* Track-list import (portable version of src/main/importList.ts)      */
/* ------------------------------------------------------------------ */

const CONCURRENCY = 3

/** FNV-1a, twice with different seeds: stable, portable, not security-sensitive. */
function hashKey(input: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index)
    a ^= code
    a = Math.imul(a, 0x01000193)
    b ^= code + index
    b = Math.imul(b, 0x85ebca6b)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

function listTrackId(artist: string, title: string): string {
  return `list:${hashKey(matchKey(artist, title) || title)}`
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

function archiveScore(track: Track, entry: TrackListEntry): number {
  const title = normalizeForMatch(entry.title)
  const artist = normalizeForMatch(entry.artist)
  if (!title) return 0
  const hitTitle = normalizeForMatch(track.title)
  const hitArtist = normalizeForMatch(track.artist)

  let score = 0
  if (hitTitle === title) score += 5
  else if (hitTitle.includes(title) || title.includes(hitTitle)) score += 3
  else return 0

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
    return null
  }
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

async function findLyrics(track: Track): Promise<Lyrics | null> {
  if (!track.artist && !track.title) return null
  const exact = await lrclibGet(track.artist, track.title, track.duration ?? null)
  if (exact) return lyricsFrom(exact, track.id)
  const fuzzy = await lrclibSearch(track.artist, track.title, track.duration ?? null)
  const best = fuzzy.find((candidate) => candidate.score > 0) ?? fuzzy[0]
  return best ? lyricsFrom(best, track.id) : null
}

async function runTrackList(request: ImportListRequest): Promise<ImportListOutcome> {
  const startedAt = Date.now()
  const entries = uniqueEntries(request.entries ?? [])
  if (entries.length === 0) throw new Error(t('Список пуст — вставьте строки вида «Исполнитель — Название»'))
  if (entries.length > 5000) throw new Error(t('Слишком много строк (больше 5000)'))

  const db = await store.loadDb()
  const settings = db.settings
  const canSearchArchive =
    Boolean(request.searchArchive) && settings.onlineProviders && settings.providers.archive
  const canFetchLyrics =
    Boolean(request.fetchLyrics) && settings.onlineProviders && settings.providers.lrclib

  const localTracks = Object.values(db.tracks).filter(
    (track) => Boolean(track.filePath) || track.source === 'local'
  )
  const byKey = new Map<string, Track>()
  const byTitle = new Map<string, Track>()
  for (const track of localTracks) {
    const key = matchKey(track.artist, track.title)
    if (!byKey.has(key)) byKey.set(key, track)
    const tKey = titleKey(track.title)
    if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, track)
  }

  let done = 0
  emitImport({ done: 0, total: entries.length, current: '' })

  const results: { entry: TrackListEntry; track: Track; match: 'local' | 'archive' | 'metadata' }[] = []
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= entries.length) return
      const entry = entries[index]
      let track: Track | null = null
      let match: 'local' | 'archive' | 'metadata' = 'metadata'

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
          streamUrl: '',
          addedAt: Date.now()
        }
      }

      done += 1
      emitImport({ done, total: entries.length, current: entry.title })
      results[index] = { entry, track, match }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker())
  )

  const lyricsByTrack = new Map<string, Lyrics>()
  if (canFetchLyrics) {
    const targets = results
      .map((item) => item.track)
      .filter((track, index, all) => all.findIndex((t) => t.id === track.id) === index)
      .filter((track) => !db.lyrics[track.id])

    let lyricCursor = 0
    const lyricWorker = async (): Promise<void> => {
      for (;;) {
        const index = lyricCursor++
        if (index >= targets.length) return
        const lyrics = await findLyrics(targets[index])
        if (lyrics) lyricsByTrack.set(lyrics.trackId, lyrics)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => lyricWorker())
    )
  }

  await store.updateDb((doc) => {
    for (const { track, match } of results) {
      const existing = doc.tracks[track.id]
      if (match === 'metadata' && existing) continue
      if (match === 'local' && existing) continue
      doc.tracks[track.id] = { ...existing, ...track, addedAt: existing?.addedAt ?? track.addedAt }
    }
    for (const lyrics of lyricsByTrack.values()) doc.lyrics[lyrics.trackId] = lyrics
  })

  const entryResults: ImportListEntryResult[] = results.map(({ entry, track, match }) => ({
    raw: entry.raw,
    artist: entry.artist,
    title: entry.title,
    trackId: track.id,
    match,
    matchedTitle: track.title,
    lyrics: !canFetchLyrics ? 'skipped' : lyricsByTrack.has(track.id) ? 'saved' : 'none'
  }))

  return {
    results: entryResults,
    trackIds: entryResults.map((result) => result.trackId),
    stats: {
      total: entryResults.length,
      local: entryResults.filter((r) => r.match === 'local').length,
      archive: entryResults.filter((r) => r.match === 'archive').length,
      metadata: entryResults.filter((r) => r.match === 'metadata').length,
      lyrics: lyricsByTrack.size
    },
    durationMs: Date.now() - startedAt
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Thrown for features that only exist in a later phase of the port. */
function notYet(feature: string): never {
  throw new Error(t('{0} появится в следующем обновлении Android-версии', { 0: feature }))
}

export function createAndroidApi(): KolaarsApi {
  return {
    app: {
      info: async (): Promise<AppInfo> => {
        const native = await App.getInfo().catch(() => null)
        const userAgent = navigator.userAgent
        const chrome = userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—'
        const profile = store.activeProfile()
        return {
          name: native?.name || 'Kolaars Music',
          version: native?.version || '1.0.0',
          electron: '—',
          chrome,
          node: '—',
          // Hard-coded: this adapter only ever runs inside the Android shell.
          // `Capacitor.getPlatform()` reports 'web' while the native bridge is
          // still being injected, and bootstrap reads this field once, so the
          // whole UI would think it is on the desktop.
          platform: 'android',
          userData: store.userDataLabel(),
          downloadsDir: store.downloadsLabel(),
          seedTracks: SEED_COUNT,
          profile: profile ? { id: profile.id, name: profile.name } : null,
          lyricsPack: PACK_INFO
        }
      },
      openExternal: async (rawUrl: string): Promise<boolean> => {
        const url = String(rawUrl ?? '')
        if (!/^https?:\/\//i.test(url)) throw new Error(t('Разрешены только http(s)-ссылки'))
        await Browser.open({ url })
        return true
      },
      minimize: async () => false,
      toggleMaximize: async () => false,
      close: async () => {
        await App.minimizeApp()
        return true
      },
      onWindowState: () => () => undefined,
      onMediaCommand: () => () => undefined,
      onNavigate: () => () => undefined
    },

    discord: {
      configure: async (): Promise<DiscordRpcStatus> => ({ state: 'disabled' }),
      setActivity: async (_presence: DiscordPresence | null): Promise<DiscordRpcStatus> => ({
        state: 'disabled'
      }),
      status: async (): Promise<DiscordRpcStatus> => ({ state: 'disabled' }),
      onStatus: () => () => undefined
    },

    store: {
      load: async (): Promise<LibrarySnapshot> => {
        const db = await store.loadDb()
        return {
          settings: db.settings,
          playlists: db.playlists,
          favorites: db.favorites,
          tracks: Object.values(db.tracks),
          history: db.history,
          session: db.session,
          lyricsIds: Object.keys(db.lyrics)
        }
      },
      saveSettings: (patch: Partial<Settings>) => store.setSettings(patch),
      saveSession: (patch: Partial<SessionState>) => store.setSession(patch)
    },

    profiles: {
      list: async (): Promise<ProfilesState> => {
        const registry = await store.listProfiles()
        return { activeId: registry.activeId, profiles: registry.profiles }
      },
      create: async (name: string) => {
        const registry = await store.createProfile(name)
        return { activeId: registry.activeId, profiles: registry.profiles }
      },
      rename: async (id: string, name: string) => {
        const registry = await store.renameProfile(id, name)
        return { activeId: registry.activeId, profiles: registry.profiles }
      },
      remove: async (id: string) => {
        const registry = await store.deleteProfile(id)
        return { activeId: registry.activeId, profiles: registry.profiles }
      },
      switch: async (id: string) => {
        const registry = await store.setActiveProfile(id)
        return { activeId: registry.activeId, profiles: registry.profiles }
      }
    },

    catalog: {
      seed: async (): Promise<Track[]> => SEED_TRACKS,
      genres: async () => deriveGenres(SEED_TRACKS),
      shelves: async (): Promise<ShelfDescriptor[]> =>
        SHELVES.map(({ id, title, subtitle, query }) => ({ id, title, subtitle, query })),
      collections: async (): Promise<ArchiveCollection[]> => ARCHIVE_COLLECTIONS
    },

    library: {
      list: async () => {
        const db = await store.loadDb()
        return {
          tracks: Object.values(db.tracks),
          favorites: db.favorites,
          lyricsIds: Object.keys(db.lyrics)
        }
      },
      addTrack: (track: Track) =>
        store.updateDb((db) => {
          const existing = db.tracks[track.id]
          const merged: Track = { ...existing, ...track, addedAt: existing?.addedAt ?? Date.now() }
          db.tracks[track.id] = merged
          return merged
        }),
      updateTrack: (id: string, patch: Partial<Track>) =>
        store.updateDb((db) => {
          const existing = db.tracks[id]
          if (!existing) return null
          const next = { ...existing, ...patch, id }
          db.tracks[id] = next
          return next
        }),
      removeTrack: async (id: string) => {
        const before = await store.loadDb()
        const local = before.tracks[id]
        const filePath = local?.source === 'local' ? local.filePath ?? null : null
        const coverPath = localArtworkPath(local?.artwork ?? null)
        const existed = await store.updateDb((db) => {
          const existed = Boolean(db.tracks[id])
          delete db.tracks[id]
          delete db.lyrics[id]
          db.favorites = db.favorites.filter((favorite) => favorite !== id)
          db.history = db.history.filter((item) => item.trackId !== id)
          if (filePath) {
            db.importedPaths = db.importedPaths.filter((path) => path !== filePath)
          }
          for (const playlist of db.playlists) {
            playlist.trackIds = playlist.trackIds.filter((trackId) => trackId !== id)
          }
          const current = db.session.queue[db.session.queueIndex]?.uid
          db.session.queue = db.session.queue.filter((item) => item.trackId !== id)
          if (current) {
            const index = db.session.queue.findIndex((item) => item.uid === current)
            if (index >= 0) {
              db.session.queueIndex = index
            } else {
              const fallback = Math.min(
                Math.max(0, db.session.queueIndex - 1),
                db.session.queue.length - 1
              )
              db.session.queueIndex = db.session.queue.length > 0 ? fallback : -1
              db.session.trackId = db.session.queue[db.session.queueIndex]?.trackId ?? null
              db.session.position = 0
            }
          }
          return existed
        })
        // The imported copy belongs to the app: dropping the track must free
        // the storage too, otherwise `files/music` grows forever.
        if (existed && filePath) {
          await deleteCopiedFile(filePath)
        }
        if (existed && coverPath) {
          await deleteCopiedFile(coverPath)
        }
        return existed
      },
      toggleFavorite: (trackId: string) =>
        store.updateDb((db) => {
          const set = new Set(db.favorites)
          if (set.has(trackId)) set.delete(trackId)
          else set.add(trackId)
          db.favorites = Array.from(set)
          return db.favorites
        }),
      addHistory: (trackId: string) =>
        store.updateDb((db) => {
          db.history = [
            ...db.history.filter((item) => item.trackId !== trackId),
            { trackId, at: Date.now() }
          ].slice(-300)
          return db.history.length
        }),
      clearHistory: () =>
        store.updateDb((db) => {
          db.history = []
          return true
        })
    },

    playlists: {
      create: (name: string, trackIds: string[] = []) =>
        store.updateDb((db) => {
          const now = Date.now()
          const playlist: Playlist = {
            id: makeId('pl'),
            name: name.trim() || t('Новый плейлист'),
            description: null,
            trackIds: [...trackIds],
            smart: false,
            createdAt: now,
            updatedAt: now
          }
          db.playlists.push(playlist)
          return playlist
        }),
      update: (id: string, patch: Partial<Pick<Playlist, 'name' | 'description'>>) =>
        store.updateDb((db) => {
          const playlist = db.playlists.find((item) => item.id === id)
          if (!playlist) return null
          if (patch.name !== undefined) playlist.name = patch.name.trim() || playlist.name
          if (patch.description !== undefined) playlist.description = patch.description
          playlist.updatedAt = Date.now()
          return playlist
        }),
      remove: (id: string) =>
        store.updateDb((db) => {
          const before = db.playlists.length
          db.playlists = db.playlists.filter((playlist) => playlist.id !== id)
          return db.playlists.length !== before
        }),
      addTracks: (id: string, trackIds: string[]) =>
        store.updateDb((db) => {
          const playlist = db.playlists.find((item) => item.id === id)
          if (!playlist) return null
          const existing = new Set(playlist.trackIds)
          for (const trackId of trackIds) {
            if (!existing.has(trackId)) {
              playlist.trackIds.push(trackId)
              existing.add(trackId)
            }
          }
          playlist.updatedAt = Date.now()
          return playlist
        }),
      removeTrack: (id: string, trackId: string) =>
        store.updateDb((db) => {
          const playlist = db.playlists.find((item) => item.id === id)
          if (!playlist) return null
          playlist.trackIds = playlist.trackIds.filter((item) => item !== trackId)
          playlist.updatedAt = Date.now()
          return playlist
        }),
      reorder: (id: string, from: number, to: number) =>
        store.updateDb((db) => {
          const playlist = db.playlists.find((item) => item.id === id)
          if (!playlist) return null
          if (from < 0 || from >= playlist.trackIds.length) return playlist
          const target = Math.max(0, Math.min(playlist.trackIds.length - 1, to))
          const [moved] = playlist.trackIds.splice(from, 1)
          playlist.trackIds.splice(target, 0, moved)
          playlist.updatedAt = Date.now()
          return playlist
        }),
      exportFile: async (id: string, format: PlaylistFileFormat) => {
        const db = await store.loadDb()
        const playlist = db.playlists.find((item) => item.id === id)
        if (!playlist) return null
        const tracks = playlist.trackIds
          .map((trackId) => db.tracks[trackId])
          .filter((track): track is Track => Boolean(track))
        return exportPlaylist(playlist, tracks, format)
      }
    },

    tracklist: {
      pickFile: pickTextFile,
      run: runTrackList
    },

    lyrics: {
      get: async (track: Pick<Track, 'id' | 'title' | 'artist'>) => {
        const db = await store.loadDb()
        return {
          saved: db.lyrics[track.id] ?? null,
          bundled: findBundledLyrics(track)
        }
      },
      save: (lyrics: Lyrics) =>
        store.updateDb((db) => {
          const next: Lyrics = {
            ...lyrics,
            plain: lyrics.plain ?? '',
            origin: lyrics.origin ?? 'user',
            updatedAt: Date.now()
          }
          db.lyrics[next.trackId] = next
          return next
        }),
      remove: (trackId: string) =>
        store.updateDb((db) => {
          const existed = Boolean(db.lyrics[trackId])
          delete db.lyrics[trackId]
          return existed
        }),
      search: async (track: Track): Promise<LyricsCandidate[]> => {
        const db = await store.loadDb()
        if (!db.settings.onlineProviders || !db.settings.providers.lrclib) return []
        const exact = await lrclibGet(track.artist, track.title, track.duration ?? null)
        const fuzzy = await lrclibSearch(track.artist, track.title, track.duration ?? null)
        const all = exact ? [exact, ...fuzzy.filter((item) => item.plain !== exact.plain)] : fuzzy
        return all.map((candidate) => ({ ...candidate, trackId: track.id }))
      },
      sources: async (query: string) => {
        const db = await store.loadDb()
        const wikisource =
          db.settings.onlineProviders && db.settings.providers.wikisource
            ? await wikisourceSearch(query ?? '')
            : []
        return { bundled: searchBundledSongs(query ?? ''), wikisource }
      },
      bundledSearch: async (query: string) => searchBundledSongs(query ?? ''),
      bundledGet: async (songId: string, trackId: string) => bundledLyricsById(songId, trackId),
      packInfo: async () => ({ ...PACK_INFO, songs: listBundledSongs() }),
      wikisourceFetch: async (title: string, trackId: string) => {
        const db = await store.loadDb()
        if (!db.settings.onlineProviders || !db.settings.providers.wikisource) return null
        const candidate = await wikisourceFetch(title)
        return candidate ? { ...candidate, trackId } : null
      },
      importLrc: (track: Track) => importLyrics(track),
      exportLrc: (track: Track, lyrics: Lyrics) => exportLyrics(track, lyrics),
      draftTimings: async (plain: string, duration: number) => distributeTimings(plain, duration)
    },

    archive: {
      search: async (query: SearchQuery): Promise<SearchResultPage<Track>> => {
        const page = await searchArchive(query)
        const items = await hydrateArchiveTracks(page.items)
        return { ...page, items }
      },
      shelfTracks: async (shelfId: string, want = 20): Promise<Track[]> => {
        const limit = Number.isFinite(want) ? Math.min(Math.max(Math.trunc(want), 1), 100) : 20
        const shelf = SHELVES.find((item) => item.id === shelfId)
        if (!shelf) return []
        try {
          const page = await searchArchive({ text: shelf.query, pageSize: limit })
          if (page.items.length === 0) throw new Error('empty result')
          return await hydrateArchiveTracks(page.items)
        } catch {
          const scoped = SEED_TRACKS.filter((track) => shelfOf(track) === shelfId)
          return (scoped.length ? scoped : SEED_TRACKS).slice(0, limit)
        }
      },
      resolve: (trackId: string) => resolveArchiveTrack(trackId),
      item: async (identifier: string) => {
        const db = await store.loadDb()
        return fetchArchiveItem(identifier, db.settings.preferLossless)
      }
    },

    sources: {
      status: async (): Promise<SourcesStatus> => {
        const db = await store.loadDb()
        return {
          youtube: { configured: false, enabled: db.settings.providers.youtube },
          soundcloud: { configured: false, enabled: db.settings.providers.soundcloud }
        }
      },
      setCredential: async (_provider: ExternalProvider, _value: string) =>
        notYet(t('Ключи YouTube и SoundCloud')),
      clearCredential: async (_provider: ExternalProvider) =>
        notYet(t('Ключи YouTube и SoundCloud')),
      search: async (_query: SourceSearchQuery) => notYet(t('Поиск по внешним источникам')),
      resolve: async (_trackId: string) => notYet(t('Внешние источники'))
    },

    local: {
      pickFiles,
      pickFolder,
      pickDownloadDir: async () => notYet(t('Выбор папки загрузок')),
      importPaths: (paths: string[]) =>
        importHandles(paths, (done, total, current) => emitImport({ done, total, current })),
      reveal: async () => false
    },

    downloads: {
      start: async (_track: Track) => notYet(t('Офлайн-загрузки')),
      list: async () => [],
      cancel: async () => false,
      remove: async () => false,
      reveal: async () => false
    },

    events: {
      onDownloadProgress: (callback) => {
        downloadListeners.add(callback)
        return () => downloadListeners.delete(callback)
      },
      onImportProgress: (callback) => {
        importListeners.add(callback)
        return () => importListeners.delete(callback)
      }
    }
  }
}

export { emitDownload, notYet }
