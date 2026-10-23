/**
 * The IPC surface.
 *
 * Everything the renderer can do to the outside world goes through here. Each
 * handler is wrapped so a thrown error becomes `{ ok: false, error }` instead of
 * an opaque rejected promise, which keeps the UI's error handling simple.
 */

import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CH, EV } from '@shared/ipc'
import { makeId } from '@shared/defaults'
import type {
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
import * as store from './db'
import {
  configureDiscordRpc,
  discordRpcStatus,
  setDiscordActivity,
  setDiscordRpcStatusSink
} from './discordRpc'
import { deriveGenres, loadSeedCatalog } from './catalog'
import { allowMediaPath, encodeMediaUrl } from './media'
import { importPaths } from './localFiles'
import {
  forgetDownloads,
  listDownloads,
  removeDownload,
  cancelDownload,
  resolveDownloadDir,
  restoreDownloads,
  setProgressSink,
  startDownload,
  type DownloadRecord
} from './downloads'
import {
  ARCHIVE_COLLECTIONS,
  SHELVES,
  fetchArchiveItem,
  hydrateArchiveTracks,
  resolveArchiveTrack,
  searchArchive
} from './providers/archive'
import { lrclibGet, lrclibSearch, wikisourceFetch, wikisourceSearch } from './providers/lyrics'
import { fetchYouTubeTrack, searchYouTube } from './providers/youtube'
import { fetchSoundCloudTrack, searchSoundCloud } from './providers/soundcloud'
import {
  clearCredential,
  credentialsStatus,
  getCredential,
  setCredential
} from './credentials'
import {
  PACK_INFO,
  bundledLyricsById,
  findBundledLyrics,
  listBundledSongs,
  searchBundledSongs
} from './lyrics/pack'
import { distributeTimings, emptyLyrics, parseLrc, serializeLrc } from '@shared/lrc'
import {
  PLAYLIST_FILE_FORMATS,
  serializePlaylist,
  type ImportListOutcome,
  type ImportListRequest,
  type PlaylistFileFormat
} from '@shared/tracklist'
import { importTrackList } from './importList'

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

let getWindow: () => BrowserWindow | null = () => null

/** Tracks that the user asked to download, kept so the library can be updated. */
const downloadOrigins = new Map<string, Track>()

function send(channel: string, payload: unknown): void {
  getWindow()?.webContents.send(channel, payload)
}

function handle<Args extends unknown[], R>(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await fn(event, ...(args as Args))
      return { ok: true as const, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel}: ${message}`)
      return { ok: false as const, error: message }
    }
  })
}

function openDialog(options: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const win = getWindow()
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

function saveDialog(options: SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  const win = getWindow()
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function registerIpc(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  // Discord status is pushed to the settings screen as the local RPC socket
  // comes and goes; the renderer never talks to Discord itself.
  setDiscordRpcStatusSink((status) => send(EV.discordRpcStatus, status))

  /* ----------------------------- app ---------------------------- */

  handle(CH.appInfo, async () => {
    const seed = await loadSeedCatalog()
    const profile = store.activeProfile()
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      userData: store.userDataDir(),
      downloadsDir: store.downloadsDir(),
      seedTracks: seed.length,
      profile: profile ? { id: profile.id, name: profile.name } : null,
      lyricsPack: PACK_INFO
    }
  })

  handle(CH.openExternal, async (_event, rawUrl: string) => {
    const url = String(rawUrl ?? '')
    if (!/^https?:\/\//i.test(url)) throw new Error('Разрешены только http(s)-ссылки')
    await shell.openExternal(url)
    return true
  })

  handle(CH.windowMinimize, () => {
    getWindow()?.minimize()
    return true
  })

  handle(CH.windowToggleMaximize, () => {
    const win = getWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  handle(CH.windowClose, () => {
    getWindow()?.close()
    return true
  })

  /* --------------------------- Discord ------------------------- */

  handle(CH.discordRpcConfigure, (_event, enabled: boolean, clientId: string): DiscordRpcStatus =>
    configureDiscordRpc(enabled, clientId)
  )

  handle(CH.discordRpcActivity, (_event, presence: DiscordPresence | null): DiscordRpcStatus =>
    setDiscordActivity(presence)
  )

  handle(CH.discordRpcStatus, (): DiscordRpcStatus => discordRpcStatus())

  /* ------------------------ settings & session ------------------ */

  handle(CH.dbLoad, async () => {
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
  })

  handle(CH.dbSettings, async (_event, patch: Partial<Settings>): Promise<Settings> => {
    return store.updateDb((db) => {
      db.settings = {
        ...db.settings,
        ...patch,
        providers: { ...db.settings.providers, ...(patch.providers ?? {}) }
      }
      return db.settings
    })
  })

  handle(CH.dbSession, async (_event, patch: Partial<SessionState>): Promise<SessionState> => {
    return store.updateDb((db) => {
      db.session = { ...db.session, ...patch }
      return db.session
    })
  })

  /* ---------------------------- profiles ------------------------ */

  handle(CH.profilesList, async () => {
    const reg = await store.listProfiles()
    return { activeId: reg.activeId, profiles: reg.profiles }
  })

  handle(CH.profilesCreate, async (_event, name: string) => {
    const reg = await store.createProfile(name)
    return { activeId: reg.activeId, profiles: reg.profiles }
  })

  handle(CH.profilesRename, async (_event, id: string, name: string) => {
    const reg = await store.renameProfile(id, name)
    return { activeId: reg.activeId, profiles: reg.profiles }
  })

  handle(CH.profilesDelete, async (_event, id: string) => {
    const reg = await store.deleteProfile(id)
    return { activeId: reg.activeId, profiles: reg.profiles }
  })

  handle(CH.profilesSwitch, async (_event, id: string) => {
    const reg = await store.setActiveProfile(id)
    // Downloads, records and offline paths all belong to the profile that
    // started them, so the previous profile's are dropped and the new one's
    // files are re-attached to the media protocol.
    forgetDownloads()
    const db = await store.loadDb()
    await restoreDownloads(resolveDownloadDir(db.settings.downloadDir))
    return { activeId: reg.activeId, profiles: reg.profiles }
  })

  /* ---------------------------- library ------------------------- */

  handle(CH.catalogSeed, async (): Promise<Track[]> => loadSeedCatalog())

  handle(CH.catalogGenres, async () => {
    const seed = await loadSeedCatalog()
    return deriveGenres(seed)
  })

  handle(CH.libraryList, async () => {
    const db = await store.loadDb()
    return {
      tracks: Object.values(db.tracks),
      favorites: db.favorites,
      lyricsIds: Object.keys(db.lyrics)
    }
  })

  handle(CH.trackAdd, async (_event, track: Track): Promise<Track> => {
    return store.updateDb((db) => {
      const existing = db.tracks[track.id]
      const merged: Track = { ...existing, ...track, addedAt: existing?.addedAt ?? Date.now() }
      db.tracks[track.id] = merged
      if (merged.filePath) allowMediaPath(merged.filePath)
      return merged
    })
  })

  handle(CH.trackUpdate, async (_event, id: string, patch: Partial<Track>): Promise<Track | null> => {
    return store.updateDb((db) => {
      const existing = db.tracks[id]
      if (!existing) return null
      const next = { ...existing, ...patch, id }
      db.tracks[id] = next
      if (next.filePath) allowMediaPath(next.filePath)
      return next
    })
  })

  handle(CH.trackRemove, async (_event, id: string): Promise<boolean> => {
    return store.updateDb((db) => {
      const existed = Boolean(db.tracks[id])
      delete db.tracks[id]
      delete db.lyrics[id]
      db.favorites = db.favorites.filter((f) => f !== id)
      db.history = db.history.filter((h) => h.trackId !== id)
      for (const playlist of db.playlists) {
        playlist.trackIds = playlist.trackIds.filter((t) => t !== id)
      }
      // The queue must forget the track as well, otherwise the player would
      // come back to a file that is no longer in the library.
      const current = db.session.queue[db.session.queueIndex]?.uid
      db.session.queue = db.session.queue.filter((item) => item.trackId !== id)
      if (current) {
        const index = db.session.queue.findIndex((item) => item.uid === current)
        if (index >= 0) {
          db.session.queueIndex = index
        } else {
          // The playing track itself is gone: step back to what is left, so a
          // restart still restores the queue instead of falling to nothing.
          const fallback = Math.min(Math.max(0, db.session.queueIndex - 1), db.session.queue.length - 1)
          db.session.queueIndex = db.session.queue.length > 0 ? fallback : -1
          db.session.trackId = db.session.queue[db.session.queueIndex]?.trackId ?? null
          db.session.position = 0
        }
      }
      return existed
    })
  })

  handle(CH.favoritesToggle, async (_event, trackId: string): Promise<string[]> => {
    return store.updateDb((db) => {
      const set = new Set(db.favorites)
      if (set.has(trackId)) set.delete(trackId)
      else set.add(trackId)
      db.favorites = Array.from(set)
      return db.favorites
    })
  })

  handle(CH.historyAdd, async (_event, trackId: string): Promise<number> => {
    return store.updateDb((db) => {
      db.history = [
        ...db.history.filter((h) => h.trackId !== trackId),
        { trackId, at: Date.now() }
      ].slice(-300)
      return db.history.length
    })
  })

  handle(CH.historyClear, async (): Promise<boolean> => {
    return store.updateDb((db) => {
      db.history = []
      return true
    })
  })

  /* ---------------------------- playlists ----------------------- */

  handle(CH.playlistCreate, async (_event, name: string, trackIds: string[] = []): Promise<Playlist> => {
    return store.updateDb((db) => {
      const now = Date.now()
      const playlist: Playlist = {
        id: makeId('pl'),
        name: name.trim() || 'Новый плейлист',
        description: null,
        trackIds: [...trackIds],
        smart: false,
        createdAt: now,
        updatedAt: now
      }
      db.playlists.push(playlist)
      return playlist
    })
  })

  handle(
    CH.playlistUpdate,
    async (
      _event,
      id: string,
      patch: Partial<Pick<Playlist, 'name' | 'description'>>
    ): Promise<Playlist | null> => {
      return store.updateDb((db) => {
        const playlist = db.playlists.find((p) => p.id === id)
        if (!playlist) return null
        if (patch.name !== undefined) playlist.name = patch.name.trim() || playlist.name
        if (patch.description !== undefined) playlist.description = patch.description
        playlist.updatedAt = Date.now()
        return playlist
      })
    }
  )

  handle(CH.playlistDelete, async (_event, id: string): Promise<boolean> => {
    return store.updateDb((db) => {
      const before = db.playlists.length
      db.playlists = db.playlists.filter((p) => p.id !== id)
      return db.playlists.length !== before
    })
  })

  handle(CH.playlistAddTracks, async (_event, id: string, trackIds: string[]): Promise<Playlist | null> => {
    return store.updateDb((db) => {
      const playlist = db.playlists.find((p) => p.id === id)
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
    })
  })

  handle(CH.playlistRemoveTrack, async (_event, id: string, trackId: string): Promise<Playlist | null> => {
    return store.updateDb((db) => {
      const playlist = db.playlists.find((p) => p.id === id)
      if (!playlist) return null
      playlist.trackIds = playlist.trackIds.filter((t) => t !== trackId)
      playlist.updatedAt = Date.now()
      return playlist
    })
  })

  handle(CH.playlistReorder, async (_event, id: string, from: number, to: number): Promise<Playlist | null> => {
    return store.updateDb((db) => {
      const playlist = db.playlists.find((p) => p.id === id)
      if (!playlist) return null
      if (from < 0 || from >= playlist.trackIds.length) return playlist
      const target = Math.max(0, Math.min(playlist.trackIds.length - 1, to))
      const [moved] = playlist.trackIds.splice(from, 1)
      playlist.trackIds.splice(target, 0, moved)
      playlist.updatedAt = Date.now()
      return playlist
    })
  })

  handle(
    CH.playlistExport,
    async (
      _event,
      id: string,
      format: PlaylistFileFormat
    ): Promise<{ path: string; count: number } | null> => {
      const db = await store.loadDb()
      const playlist = db.playlists.find((p) => p.id === id)
      if (!playlist) throw new Error('Плейлист не найден')

      // A playlist may reference seeded catalog tracks that live outside the
      // profile document, so resolve against both.
      const seed = await loadSeedCatalog()
      const byId = new Map<string, Track>()
      for (const track of seed) byId.set(track.id, track)
      for (const track of Object.values(db.tracks)) byId.set(track.id, track)

      const tracks = playlist.trackIds
        .map((trackId) => byId.get(trackId))
        .filter((track): track is Track => Boolean(track))
        .map((track) => ({
          artist: track.artist,
          title: track.title,
          album: track.album ?? null,
          duration: track.duration ?? null,
          // Only a file the user actually has on disk is referenced; a stream
          // link is never written out.
          path: track.filePath ?? null
        }))

      const chosen = PLAYLIST_FILE_FORMATS.find((f) => f.value === format) ?? PLAYLIST_FILE_FORMATS[0]
      const safe = playlist.name.replace(/[<>:"/\\|?*]/g, ' ').trim() || 'playlist'
      const result = await saveDialog({
        title: `Экспорт плейлиста (${chosen.label})`,
        defaultPath: `${safe}.${chosen.extension}`,
        filters: [{ name: chosen.label, extensions: [chosen.extension] }]
      })
      if (result.canceled || !result.filePath) return null

      await fs.writeFile(result.filePath, serializePlaylist(chosen.value, playlist.name, tracks), 'utf8')
      return { path: result.filePath, count: tracks.length }
    }
  )

  /* ----------------------------- lyrics ------------------------- */

  handle(
    CH.lyricsGet,
    async (
      _event,
      track: Pick<Track, 'id' | 'title' | 'artist'>
    ): Promise<{ saved: Lyrics | null; bundled: Lyrics | null }> => {
      const db = await store.loadDb()
      return {
        saved: db.lyrics[track.id] ?? null,
        bundled: findBundledLyrics(track)
      }
    }
  )

  handle(CH.lyricsSave, async (_event, lyrics: Lyrics): Promise<Lyrics> => {
    return store.updateDb((db) => {
      const next: Lyrics = {
        ...lyrics,
        plain: lyrics.plain ?? '',
        origin: lyrics.origin ?? 'user',
        updatedAt: Date.now()
      }
      db.lyrics[next.trackId] = next
      return next
    })
  })

  handle(CH.lyricsDelete, async (_event, trackId: string): Promise<boolean> => {
    return store.updateDb((db) => {
      const existed = Boolean(db.lyrics[trackId])
      delete db.lyrics[trackId]
      return existed
    })
  })

  handle(CH.lyricsPackInfo, () => ({ ...PACK_INFO, songs: listBundledSongs() }))

  handle(CH.lyricsBundledSearch, async (_event, query: string) => searchBundledSongs(query ?? ''))

  handle(CH.lyricsBundledGet, async (_event, songId: string, trackId: string): Promise<Lyrics | null> =>
    bundledLyricsById(songId, trackId)
  )

  handle(CH.lyricsSearch, async (_event, track: Track): Promise<LyricsCandidate[]> => {
    const db = await store.loadDb()
    if (!db.settings.onlineProviders || !db.settings.providers.lrclib) return []
    const exact = await lrclibGet(track.artist, track.title, track.duration ?? null)
    const fuzzy = await lrclibSearch(track.artist, track.title, track.duration ?? null)
    const all = exact ? [exact, ...fuzzy.filter((c) => c.plain !== exact.plain)] : fuzzy
    return all.map((c) => ({ ...c, trackId: track.id }))
  })

  handle(CH.lyricsSources, async (_event, query: string) => {
    const db = await store.loadDb()
    const wikisource =
      db.settings.onlineProviders && db.settings.providers.wikisource
        ? await wikisourceSearch(query ?? '')
        : []
    return { bundled: searchBundledSongs(query ?? ''), wikisource }
  })

  handle(CH.lyricsWikisourceFetch, async (_event, title: string, trackId: string): Promise<Lyrics | null> => {
    const db = await store.loadDb()
    if (!db.settings.onlineProviders || !db.settings.providers.wikisource) return null
    const candidate = await wikisourceFetch(title)
    return candidate ? { ...candidate, trackId } : null
  })

  handle(CH.lyricsImportLrc, async (_event, track: Track): Promise<Lyrics | null> => {
    const result = await openDialog({
      title: 'Импорт текста (.lrc)',
      properties: ['openFile'],
      filters: [
        { name: 'Тексты (LRC)', extensions: ['lrc', 'txt'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const text = await fs.readFile(result.filePaths[0], 'utf8')
    const parsed = parseLrc(text)
    const lyrics: Lyrics = {
      ...emptyLyrics(track.id),
      plain: parsed.plain,
      synced: parsed.synced.length ? parsed.synced : null,
      meta: parsed.meta,
      origin: 'lrc-file',
      provider: path.basename(result.filePaths[0]),
      updatedAt: Date.now()
    }
    await store.updateDb((db) => {
      db.lyrics[track.id] = lyrics
    })
    return lyrics
  })

  handle(CH.lyricsExportLrc, async (_event, track: Track, lyrics: Lyrics): Promise<string | null> => {
    const safe = `${track.artist} - ${track.title}`.replace(/[<>:"/\\|?*]/g, ' ').trim()
    const result = await saveDialog({
      title: 'Сохранить текст как .lrc',
      defaultPath: `${safe || 'lyrics'}.lrc`,
      filters: [{ name: 'Тексты (LRC)', extensions: ['lrc'] }]
    })
    if (result.canceled || !result.filePath) return null

    const content = lyrics.synced?.length
      ? serializeLrc(lyrics.synced, {
          ti: track.title,
          ar: track.artist,
          ...(track.album ? { al: track.album } : {}),
          ...(lyrics.meta ?? {})
        })
      : lyrics.plain

    await fs.writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })

  handle(CH.lyricsDraftTimings, async (_event, plain: string, duration: number) =>
    distributeTimings(plain, duration)
  )

  /* ---------------------------- archive ------------------------- */

  handle(CH.archiveSearch, async (_event, query: SearchQuery): Promise<SearchResultPage<Track>> => {
    const page = await searchArchive(query)
    const items = await hydrateArchiveTracks(page.items)
    return { ...page, items }
  })

  handle(CH.archiveShelves, () => SHELVES.map(({ id, title, subtitle, query }) => ({ id, title, subtitle, query })))

  handle(CH.archiveCollections, () => ARCHIVE_COLLECTIONS)

  handle(CH.archiveShelfTracks, async (_event, shelfId: string, want = 20): Promise<Track[]> => {
    const limit = Number.isFinite(want) ? Math.min(Math.max(Math.trunc(Number(want)), 1), 100) : 20
    const shelf = SHELVES.find((s) => s.id === shelfId)
    if (!shelf) return []
    try {
      const page = await searchArchive({ text: shelf.query, pageSize: limit })
      if (page.items.length === 0) throw new Error('empty result')
      return await hydrateArchiveTracks(page.items)
    } catch (err) {
      // Offline, or the upstream query changed: fall back to the bundled catalog.
      console.warn(`[archive] shelf ${shelfId} fell back to seed: ${(err as Error).message}`)
      const seed = await loadSeedCatalog()
      const scoped = seed.filter((track) => (track as Track & { shelf?: string }).shelf === shelfId)
      return (scoped.length ? scoped : seed).slice(0, limit)
    }
  })

  handle(CH.archiveResolve, async (_event, trackId: string): Promise<Track | null> => resolveArchiveTrack(trackId))

  handle(CH.archiveItem, async (_event, identifier: string) => {
    const db = await store.loadDb()
    return fetchArchiveItem(identifier, db.settings.preferLossless)
  })

  /* ------------------- external sources (official) ---------------- */

  handle(CH.sourcesStatus, async (): Promise<SourcesStatus> => readSourcesStatus())

  handle(CH.sourcesSetCredential, async (_event, provider: ExternalProvider, value: string) => {
    await setCredential(provider, value)
    return readSourcesStatus()
  })

  handle(CH.sourcesClearCredential, async (_event, provider: ExternalProvider) => {
    await clearCredential(provider)
    return readSourcesStatus()
  })

  handle(
    CH.sourcesSearch,
    async (_event, query: SourceSearchQuery): Promise<SearchResultPage<Track>> => {
      const db = await store.loadDb()
      if (!db.settings.onlineProviders) throw new Error('Онлайн-источники отключены в настройках')

      const provider = query?.provider
      if (provider !== 'youtube' && provider !== 'soundcloud') throw new Error('Неизвестный источник')
      if (!db.settings.providers[provider]) throw new Error('Этот источник выключен в настройках')

      const key = await getCredential(provider)
      if (!key) {
        throw new Error(
          provider === 'youtube'
            ? 'Сначала добавьте ключ YouTube Data API на экране «Источники»'
            : 'Сначала добавьте SoundCloud client_id на экране «Источники»'
        )
      }

      const text = String(query.text ?? '')
      if (!text.trim()) return { items: [], page: 1, pageSize: query.pageSize ?? 24, total: 0, hasMore: false }

      const request: SourceSearchQuery = { ...query, text }
      return provider === 'youtube'
        ? searchYouTube(key, request)
        : searchSoundCloud(key, request)
    }
  )

  handle(CH.sourcesResolve, async (_event, trackId: string): Promise<Track | null> => {
    if (typeof trackId !== 'string') return null
    const db = await store.loadDb()
    if (!db.settings.onlineProviders) return null

    if (trackId.startsWith('yt:')) {
      if (!db.settings.providers.youtube) return null
      const key = await getCredential('youtube')
      return key ? fetchYouTubeTrack(key, trackId.slice(3)) : null
    }
    if (trackId.startsWith('sc:')) {
      if (!db.settings.providers.soundcloud) return null
      const key = await getCredential('soundcloud')
      return key ? fetchSoundCloudTrack(key, trackId.slice(3)) : null
    }
    return null
  })

  /* ---------------------- track-list import --------------------- */

  handle(CH.listPickFile, async (): Promise<{ path: string; text: string } | null> => {
    const result = await openDialog({
      title: 'Открыть список треков',
      properties: ['openFile'],
      filters: [
        { name: 'Списки треков', extensions: ['txt', 'csv', 'tsv', 'm3u', 'm3u8', 'list'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const stat = await fs.stat(filePath)
    if (stat.size > 4 * 1024 * 1024) throw new Error('Файл слишком большой (больше 4 МБ)')
    return { path: filePath, text: await fs.readFile(filePath, 'utf8') }
  })

  handle(CH.listImport, async (_event, request: ImportListRequest): Promise<ImportListOutcome> => {
    const entries = Array.isArray(request?.entries) ? request.entries : []
    if (entries.length === 0) throw new Error('Список пуст — вставьте строки вида «Исполнитель — Название»')
    if (entries.length > 5000) throw new Error('Слишком много строк (больше 5000)')
    return importTrackList(
      {
        entries,
        searchArchive: Boolean(request.searchArchive),
        fetchLyrics: Boolean(request.fetchLyrics)
      },
      (done, total, current) => send(EV.importProgress, { done, total, current })
    )
  })

  /* -------------------------- local files ----------------------- */

  handle(CH.localPickFiles, async (): Promise<string[]> => {
    const result = await openDialog({
      title: 'Импорт музыки',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Аудио',
          extensions: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aiff', 'wma']
        },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(CH.localPickFolder, async (): Promise<string | null> => {
    const result = await openDialog({
      title: 'Импорт папки с музыкой',
      properties: ['openDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  handle(CH.localPickDownloadDir, async (): Promise<string | null> => {
    const result = await openDialog({
      title: 'Папка для офлайн-загрузок',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  handle(CH.localImport, async (_event, inputs: string[]) => {
    const outcome = await importPaths(inputs, (done, total, current) => {
      send(EV.importProgress, { done, total, current })
    })
    await store.updateDb((db) => {
      for (const track of outcome.tracks) {
        db.tracks[track.id] = track
        if (track.filePath) {
          db.importedPaths = [...db.importedPaths.filter((p) => p !== track.filePath), track.filePath]
        }
      }
      for (const lyrics of outcome.lyrics) db.lyrics[lyrics.trackId] = lyrics
    })
    return outcome
  })

  handle(CH.localReveal, async (_event, filePath: string) => {
    if (!filePath) return false
    shell.showItemInFolder(filePath)
    return true
  })

  /* --------------------------- downloads ------------------------ */

  handle(CH.downloadList, (): DownloadRecord[] => listDownloads())

  handle(CH.downloadStart, async (_event, track: Track): Promise<DownloadRecord> => {
    if (!track.streamUrl) throw new Error('У трека нет прямой ссылки для скачивания')
    const db = await store.loadDb()
    downloadOrigins.set(track.id, track)
    return startDownload(track, resolveDownloadDir(db.settings.downloadDir))
  })

  handle(CH.downloadCancel, (_event, trackId: string): boolean => cancelDownload(trackId))

  handle(CH.downloadReveal, async (_event, trackId: string): Promise<boolean> => {
    const record = listDownloads().find((r) => r.trackId === trackId)
    if (!record?.filePath) return false
    shell.showItemInFolder(record.filePath)
    return true
  })

  handle(CH.downloadRemove, async (_event, trackId: string): Promise<boolean> => {
    const record = listDownloads().find((r) => r.trackId === trackId)
    await removeDownload(trackId)
    downloadOrigins.delete(trackId)

    // Undo the "offline override" we applied when the download completed.
    await store.updateDb((state) => {
      const track = state.tracks[trackId]
      if (track?.offline && record?.filePath && track.filePath === record.filePath) {
        delete state.tracks[trackId]
      }
    })
    return true
  })

  /* --------------------------- downloads sink ------------------- */

  setProgressSink((record) => {
    void applyDownloadToLibrary(record)
    send(EV.downloadProgress, record)
  })
}

async function readSourcesStatus(): Promise<SourcesStatus> {
  const db = await store.loadDb()
  const credentials = await credentialsStatus()
  return {
    youtube: {
      configured: credentials.youtube,
      enabled: db.settings.providers.youtube
    },
    soundcloud: {
      configured: credentials.soundcloud,
      enabled: db.settings.providers.soundcloud
    }
  }
}

async function applyDownloadToLibrary(record: DownloadRecord): Promise<void> {
  if (record.status !== 'done' || !record.filePath) return
  allowMediaPath(record.filePath)
  const url = encodeMediaUrl(record.filePath)
  const origin = downloadOrigins.get(record.trackId)

  await store.updateDb((db) => {
    const track = db.tracks[record.trackId]
    if (track) {
      track.filePath = record.filePath
      track.streamUrl = url
      track.offline = true
      return
    }
    if (origin) {
      // Seeded or search-result track: keep the id (playlists keep working) and
      // add an override that points at the downloaded copy.
      db.tracks[record.trackId] = {
        ...origin,
        filePath: record.filePath,
        streamUrl: url,
        offline: true,
        addedAt: Date.now()
      }
    }
  })
}
