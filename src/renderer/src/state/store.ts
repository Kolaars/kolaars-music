/**
 * The application store: catalog, library, playlists, settings and UI state.
 *
 * Playback lives in its own store (`state/player.ts`) because it updates many
 * times per second; keeping it separate means the heavy library views never
 * re-render while a track is playing.
 */

import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { parseTrackList, type ImportListOutcome, type PlaylistFileFormat } from '@shared/tracklist'
import type { Playlist, Profile, Settings, Track } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import type { AppInfo, DownloadRecord, ShelfDescriptor } from '../../../preload/index'

/** Result of importing a track list: what was found, and the new playlist. */
export interface TrackListImportResult {
  outcome: ImportListOutcome
  playlist: Playlist | null
}

export type Route =
  | { name: 'discover' }
  | { name: 'search'; query?: string }
  | { name: 'library' }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string }
  | { name: 'favorites' }
  | { name: 'downloads' }
  | { name: 'album'; identifier: string; title?: string }
  | { name: 'settings' }
  | { name: 'shortcuts' }
  | { name: 'about' }

export interface Toast {
  id: string
  message: string
  kind: 'info' | 'success' | 'error'
}

export interface ImportProgress {
  done: number
  total: number
  current: string
}

interface AppState {
  ready: boolean
  appInfo: AppInfo | null

  /** Local profiles: independent libraries on the same machine. */
  profiles: Profile[]
  activeProfileId: string

  settings: Settings
  seedTracks: Track[]
  userTracks: Track[]
  /** Seed catalog merged with user tracks (user entries win). */
  catalog: Track[]
  catalogIndex: Map<string, Track>

  playlists: Playlist[]
  favorites: Set<string>
  lyricsIds: Set<string>
  history: { trackId: string; at: number }[]

  shelves: ShelfDescriptor[]
  downloads: DownloadRecord[]
  importProgress: ImportProgress | null

  route: Route
  routeStack: Route[]
  searchQuery: string
  nowPlayingOpen: boolean
  queueOpen: boolean
  /** Pending request to open the lyrics workshop on a given tab. */
  lyricsTab: 'text' | 'sync' | 'sources' | null

  toasts: Toast[]

  /* actions */
  bootstrap: () => Promise<void>
  setRoute: (route: Route, options?: { replace?: boolean }) => void
  goBack: () => void
  setSearchQuery: (query: string) => void
  setNowPlayingOpen: (open: boolean) => void
  setQueueOpen: (open: boolean) => void
  requestLyricsTab: (tab: 'text' | 'sync' | 'sources' | null) => void

  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void

  getTrack: (id: string | null | undefined) => Track | undefined
  /** Resolves an unresolved archive track and caches the result. */
  ensureTrack: (id: string) => Promise<Track | undefined>
  cacheResolvedTrack: (track: Track) => void
  /**
   * Stores the duration the decoder reported for a local file that had none.
   * Untagged downloads — and containers the tag reader cannot parse — only get
   * a duration the first time they are played.
   */
  rememberTrackDuration: (id: string, seconds: number) => Promise<void>
  /** Registers transient tracks (search results, album items) so they can play. */
  cacheTracks: (tracks: Track[]) => void
  /** Fetches any of `ids` that the catalog does not know about yet. */
  resolveTracks: (ids: string[]) => Promise<void>

  toggleFavorite: (trackId: string) => Promise<void>
  refreshLibrary: () => Promise<void>
  removeTrack: (trackId: string) => Promise<void>
  addHistory: (trackId: string) => void
  clearHistory: () => Promise<void>

  createPlaylist: (name: string, tracks?: Track[]) => Promise<Playlist | null>
  renamePlaylist: (id: string, name: string) => Promise<void>
  deletePlaylist: (id: string) => Promise<void>
  addTracksToPlaylist: (id: string, tracks: Track[]) => Promise<void>
  removeTrackFromPlaylist: (id: string, trackId: string) => Promise<void>
  reorderPlaylist: (id: string, from: number, to: number) => Promise<void>

  importFiles: () => Promise<void>
  importFolder: () => Promise<void>

  /** Whether the "import a track list" dialog is open. */
  importListOpen: boolean
  setImportListOpen: (open: boolean) => void
  /** Parses a pasted list, resolves it, and stores it as a playlist. */
  runTrackListImport: (options: {
    text: string
    name: string
    searchArchive: boolean
    fetchLyrics: boolean
  }) => Promise<TrackListImportResult | null>

  /** Writes a playlist to disk as M3U8, CSV or JSON. */
  exportPlaylist: (id: string, format: PlaylistFileFormat) => Promise<void>

  refreshDownloads: () => Promise<void>
  startDownload: (track: Track) => Promise<void>
  cancelDownload: (trackId: string) => Promise<void>
  removeDownload: (trackId: string) => Promise<void>

  updateSettings: (patch: Partial<Settings>) => Promise<void>

  createProfile: (name: string) => Promise<void>
  renameProfile: (id: string, name: string) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  /** Reloads the whole library from another profile directory. */
  switchProfile: (id: string) => Promise<void>
  /** Resets per-profile state and re-bootstraps; call after switching profiles. */
  reloadForProfile: () => Promise<void>
}

/** Merges the bundled catalog with the user's tracks; user entries win. */
function buildCatalog(seed: Track[], user: Track[]): { catalog: Track[]; catalogIndex: Map<string, Track> } {
  const index = new Map<string, Track>()
  for (const track of seed) index.set(track.id, track)
  for (const track of user) index.set(track.id, track)

  const catalog: Track[] = []
  const seen = new Set<string>()
  for (const track of user) {
    catalog.push(track)
    seen.add(track.id)
  }
  for (const track of seed) {
    if (!seen.has(track.id)) catalog.push(track)
  }
  return { catalog, catalogIndex: index }
}

let toastCounter = 0
/** Event subscriptions are process-global, so they are wired exactly once. */
let eventsWired = false

function wireEvents(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState
): void {
  if (eventsWired) return
  eventsWired = true

  api.events.onDownloadProgress((record) => {
    set((state) => {
      const others = state.downloads.filter((d) => d.trackId !== record.trackId)
      return { downloads: [...others, record] }
    })
    if (record.status === 'done') {
      void get().refreshLibrary()
      get().toast(`Загружено: ${record.title}`, 'success')
    } else if (record.status === 'error') {
      get().toast(`Ошибка загрузки: ${record.error ?? record.title}`, 'error')
    }
  })

  api.events.onImportProgress((progress) => set({ importProgress: progress }))
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  appInfo: null,

  profiles: [],
  activeProfileId: '',

  settings: DEFAULT_SETTINGS,
  seedTracks: [],
  userTracks: [],
  catalog: [],
  catalogIndex: new Map(),

  playlists: [],
  favorites: new Set(),
  lyricsIds: new Set(),
  history: [],

  shelves: [],
  downloads: [],
  importProgress: null,
  importListOpen: false,

  route: { name: 'discover' },
  routeStack: [],
  searchQuery: '',
  nowPlayingOpen: false,
  queueOpen: false,
  lyricsTab: null,

  toasts: [],

  /* --------------------------- lifecycle -------------------------- */

  bootstrap: async () => {
    try {
      const [info, snapshot, seed, shelves, downloads, profiles] = await Promise.all([
        api.app.info(),
        api.store.load(),
        api.catalog.seed(),
        api.catalog.shelves(),
        api.downloads.list(),
        api.profiles.list()
      ])

      const { catalog, catalogIndex } = buildCatalog(seed, snapshot.tracks)

      set({
        ready: true,
        appInfo: info,
        settings: snapshot.settings,
        seedTracks: seed,
        userTracks: snapshot.tracks,
        catalog,
        catalogIndex,
        playlists: snapshot.playlists,
        favorites: new Set(snapshot.favorites),
        lyricsIds: new Set(snapshot.lyricsIds),
        history: snapshot.history,
        shelves,
        downloads,
        profiles: profiles.profiles,
        activeProfileId: profiles.activeId
      })

      wireEvents(set, get)

      // Playlists, favourites and the restored session all persist ids only.
      // Anything the catalog does not know yet (an archive.org item the user
      // found through search) is fetched now so every view can resolve it.
      await get().resolveTracks([
        ...snapshot.playlists.flatMap((playlist) => playlist.trackIds),
        ...snapshot.favorites,
        ...snapshot.session.queue.map((item) => item.trackId),
        ...(snapshot.session.trackId ? [snapshot.session.trackId] : [])
      ])
    } catch (error) {
      set({ ready: true })
      get().toast(`Не удалось запустить приложение: ${errorMessage(error)}`, 'error')
    }
  },

  /* ---------------------------- routing --------------------------- */

  setRoute: (route, options) => {
    const current = get().route
    if (JSON.stringify(current) === JSON.stringify(route)) return
    set((state) => ({
      route,
      routeStack: options?.replace ? state.routeStack : [...state.routeStack, current].slice(-40)
    }))
  },

  goBack: () => {
    const stack = get().routeStack
    if (stack.length === 0) return
    const previous = stack[stack.length - 1]
    set({ route: previous, routeStack: stack.slice(0, -1) })
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setNowPlayingOpen: (open) => set({ nowPlayingOpen: open }),
  setQueueOpen: (open) => set({ queueOpen: open }),
  requestLyricsTab: (tab) => set({ lyricsTab: tab }),

  /* ----------------------------- toasts --------------------------- */

  toast: (message, kind = 'info') => {
    const id = `toast_${++toastCounter}`
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }].slice(-4) }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  /* ----------------------------- tracks --------------------------- */

  getTrack: (id) => (id ? get().catalogIndex.get(id) : undefined),

  ensureTrack: async (id) => {
    const existing = get().catalogIndex.get(id)
    if (!existing) return undefined
    if (existing.streamUrl) return existing
    if (!existing.identifier) return existing

    try {
      const resolved = await api.archive.resolve(id)
      if (resolved) {
        get().cacheResolvedTrack(resolved)
        return resolved
      }
    } catch (error) {
      get().toast(`Не удалось получить аудио: ${errorMessage(error)}`, 'error')
    }
    return existing
  },

  cacheResolvedTrack: (track) =>
    set((state) => {
      const nextIndex = new Map(state.catalogIndex)
      const previous = nextIndex.get(track.id)
      const merged: Track = { ...previous, ...track }
      nextIndex.set(track.id, merged)
      return {
        catalogIndex: nextIndex,
        catalog: state.catalog.map((t) => (t.id === track.id ? merged : t)),
        userTracks: state.userTracks.some((t) => t.id === track.id)
          ? state.userTracks.map((t) => (t.id === track.id ? merged : t))
          : state.userTracks
      }
    }),

  rememberTrackDuration: async (trackId, seconds) => {
    const track = get().catalogIndex.get(trackId)
    // Only local files are written back, and only when nothing is known yet.
    if (!track || track.duration || track.source !== 'local') return
    const duration = Math.max(1, Math.round(seconds))
    try {
      const updated = await api.library.updateTrack(trackId, { duration })
      if (updated) get().cacheResolvedTrack({ ...track, ...updated, duration })
    } catch {
      /* A blank duration is not worth interrupting playback for. */
    }
  },

  cacheTracks: (tracks) =>
    set((state) => {
      let changed = false
      const nextIndex = new Map(state.catalogIndex)
      for (const track of tracks) {
        const previous = nextIndex.get(track.id)
        if (!previous) {
          nextIndex.set(track.id, track)
          changed = true
          continue
        }
        // Never let an unresolved duplicate clobber a playable stream URL.
        if (previous.streamUrl && !track.streamUrl) {
          nextIndex.set(track.id, { ...previous, ...track, streamUrl: previous.streamUrl })
        } else {
          nextIndex.set(track.id, { ...previous, ...track })
        }
      }
      return changed ? { catalogIndex: nextIndex } : {}
    }),

  /**
   * Resolves ids that are not in the loaded catalog yet.
   *
   * Playlists and favourites persist track *ids* only, so an archive.org item
   * that the user found through search (and never imported) is not in
   * `catalogIndex` after a restart. This fills those gaps on demand.
   */
  resolveTracks: async (ids) => {
    const pending = Array.from(new Set(ids)).filter(
      (id) => id.startsWith('arc:') && !get().catalogIndex.has(id)
    )
    if (pending.length === 0) return
    const settled = await Promise.all(
      pending.map((id) => api.archive.resolve(id).catch(() => null))
    )
    const found = settled.filter((track): track is Track => Boolean(track))
    if (found.length > 0) get().cacheTracks(found)
  },

  toggleFavorite: async (trackId) => {
    const favorites = await api.library.toggleFavorite(trackId)
    set({ favorites: new Set(favorites) })
  },

  refreshLibrary: async () => {
    const snapshot = await api.library.list()
    const { catalog, catalogIndex } = buildCatalog(get().seedTracks, snapshot.tracks)
    // Keep transient tracks (search results, album items) resolvable during playback.
    for (const [id, track] of get().catalogIndex) {
      if (!catalogIndex.has(id)) catalogIndex.set(id, track)
    }
    const lyrics = new Set(snapshot.lyricsIds)
    set({
      userTracks: snapshot.tracks,
      catalog,
      catalogIndex,
      favorites: new Set(snapshot.favorites),
      lyricsIds: lyrics
    })
  },

  removeTrack: async (trackId) => {
    await api.library.removeTrack(trackId)
    await get().refreshLibrary()
    get().toast('Трек удалён из библиотеки')
  },

  addHistory: (trackId) => {
    set((state) => ({
      history: [...state.history.filter((h) => h.trackId !== trackId), { trackId, at: Date.now() }].slice(-300)
    }))
    void api.library.addHistory(trackId)
  },

  clearHistory: async () => {
    await api.library.clearHistory()
    set({ history: [] })
  },

  /* ---------------------------- playlists ------------------------- */

  createPlaylist: async (name, tracks) => {
    try {
      // Playlists persist ids only, so the tracks have to stay resolvable.
      if (tracks?.length) get().cacheTracks(tracks)
      const playlist = await api.playlists.create(
        name,
        tracks?.map((track) => track.id)
      )
      set((state) => ({ playlists: [...state.playlists, playlist] }))
      return playlist
    } catch (error) {
      get().toast(`Не удалось создать плейлист: ${errorMessage(error)}`, 'error')
      return null
    }
  },

  renamePlaylist: async (id, name) => {
    const updated = await api.playlists.update(id, { name })
    if (updated) {
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) }))
    }
  },

  deletePlaylist: async (id) => {
    await api.playlists.remove(id)
    set((state) => ({ playlists: state.playlists.filter((p) => p.id !== id) }))
    set((state) => (state.route.name === 'playlist' && state.route.id === id ? { route: { name: 'playlists' } } : {}))
  },

  addTracksToPlaylist: async (id, tracks) => {
    if (tracks.length === 0) return
    // The playlist keeps ids only; cache the tracks so every view can resolve
    // them (the mosaic artwork and the track list both read `catalogIndex`).
    get().cacheTracks(tracks)
    const updated = await api.playlists.addTracks(
      id,
      tracks.map((track) => track.id)
    )
    if (updated) {
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) }))
    }
  },

  removeTrackFromPlaylist: async (id, trackId) => {
    const updated = await api.playlists.removeTrack(id, trackId)
    if (updated) {
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) }))
    }
  },

  reorderPlaylist: async (id, from, to) => {
    const updated = await api.playlists.reorder(id, from, to)
    if (updated) {
      set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) }))
    }
  },

  /* --------------------------- local files ------------------------ */

  importFiles: async () => {
    const paths = await api.local.pickFiles()
    if (paths.length === 0) return
    await runImport(paths, set, get)
  },

  importFolder: async () => {
    const folder = await api.local.pickFolder()
    if (!folder) return
    await runImport([folder], set, get)
  },

  setImportListOpen: (open) => set({ importListOpen: open }),

  runTrackListImport: async ({ text, name, searchArchive, fetchLyrics }) => {
    const entries = parseTrackList(text)
    if (entries.length === 0) {
      get().toast('Не удалось разобрать список — нужны строки «Исполнитель — Название»', 'error')
      return null
    }

    try {
      const outcome = await api.tracklist.run({ entries, searchArchive, fetchLyrics })

      // Refresh first: the new tracks must be in the catalog before the
      // playlist can reference them.
      await get().refreshLibrary()

      const tracks = outcome.trackIds
        .map((id) => get().catalogIndex.get(id))
        .filter((track): track is Track => Boolean(track))
      if (tracks.length) get().cacheTracks(tracks)

      const playlist = await get().createPlaylist(name.trim() || 'Импортированный список', tracks)
      return { outcome, playlist }
    } catch (error) {
      get().toast(`Импорт списка не удался: ${errorMessage(error)}`, 'error')
      return null
    } finally {
      set({ importProgress: null })
    }
  },

  exportPlaylist: async (id, format) => {
    try {
      const written = await api.playlists.exportFile(id, format)
      if (!written) return
      get().toast(`Экспортировано треков: ${written.count}`, 'success')
    } catch (error) {
      get().toast(`Не удалось экспортировать: ${errorMessage(error)}`, 'error')
    }
  },

  /* ---------------------------- downloads ------------------------- */

  refreshDownloads: async () => {
    set({ downloads: await api.downloads.list() })
  },

  startDownload: async (track) => {
    try {
      const prepared = await get().ensureTrack(track.id)
      const target = prepared ?? track
      if (!target.streamUrl) {
        get().toast('У трека нет прямой ссылки — нечего скачивать', 'error')
        return
      }
      const record = await api.downloads.start(target)
      get().toast(`Загрузка началась: ${record.title}`, 'info')
    } catch (error) {
      get().toast(`Не удалось начать загрузку: ${errorMessage(error)}`, 'error')
    }
  },

  cancelDownload: async (trackId) => {
    await api.downloads.cancel(trackId)
  },

  removeDownload: async (trackId) => {
    await api.downloads.remove(trackId)
    await get().refreshDownloads()
    await get().refreshLibrary()
  },

  /* ---------------------------- settings -------------------------- */

  updateSettings: async (patch) => {
    const previous = get().settings
    const optimistic = {
      ...previous,
      ...patch,
      providers: { ...previous.providers, ...(patch.providers ?? {}) }
    }
    set({ settings: optimistic })
    try {
      const saved = await api.store.saveSettings(patch)
      set({ settings: saved })
    } catch (error) {
      set({ settings: previous })
      get().toast(`Не удалось сохранить настройки: ${errorMessage(error)}`, 'error')
    }
  },

  /* ---------------------------- profiles -------------------------- */

  createProfile: async (name) => {
    try {
      const state = await api.profiles.create(name)
      set({ profiles: state.profiles, activeProfileId: state.activeId })
      get().toast(`Профиль «${name.trim() || 'Новый профиль'}» создан`)
    } catch (error) {
      get().toast(`Не удалось создать профиль: ${errorMessage(error)}`, 'error')
    }
  },

  renameProfile: async (id, name) => {
    try {
      const state = await api.profiles.rename(id, name)
      set({ profiles: state.profiles, activeProfileId: state.activeId })
    } catch (error) {
      get().toast(`Не удалось переименовать профиль: ${errorMessage(error)}`, 'error')
    }
  },

  deleteProfile: async (id) => {
    const activeBefore = get().activeProfileId
    const victim = get().profiles.find((profile) => profile.id === id)
    try {
      const state = await api.profiles.remove(id)
      set({ profiles: state.profiles, activeProfileId: state.activeId })
      get().toast(`Профиль «${victim?.name ?? id}» удалён`)
      // Deleting the active profile makes the main process pick a fallback, so
      // the library has to be reloaded from that profile's directory.
      if (id === activeBefore) await get().reloadForProfile()
    } catch (error) {
      get().toast(`Не удалось удалить профиль: ${errorMessage(error)}`, 'error')
    }
  },

  switchProfile: async (id) => {
    if (!id || id === get().activeProfileId) return
    try {
      const state = await api.profiles.switch(id)
      set({ profiles: state.profiles, activeProfileId: state.activeId })
      await get().reloadForProfile()
      const name = state.profiles.find((profile) => profile.id === state.activeId)?.name ?? ''
      get().toast(`Профиль: ${name}`, 'success')
    } catch (error) {
      get().toast(`Не удалось переключить профиль: ${errorMessage(error)}`, 'error')
    }
  },

  /**
   * Drops every piece of per-profile state and loads the newly active profile.
   * Playback is stopped by the caller (`App`), because the player store cannot
   * be imported here without creating a cycle.
   */
  reloadForProfile: async () => {
    stopPlaybackForProfileSwitch()
    set({
      ready: false,
      seedTracks: [],
      userTracks: [],
      catalog: [],
      catalogIndex: new Map(),
      playlists: [],
      favorites: new Set(),
      lyricsIds: new Set(),
      history: [],
      downloads: [],
      importProgress: null,
      route: { name: 'discover' },
      routeStack: [],
      searchQuery: '',
      nowPlayingOpen: false,
      queueOpen: false,
      lyricsTab: null,
      toasts: []
    })
    await get().bootstrap()
  }
}))

/* ------------------------------------------------------------------ */
/* Import helper                                                       */
/* ------------------------------------------------------------------ */

async function runImport(
  paths: string[],
  set: (partial: Partial<AppState>) => void,
  get: () => AppState
): Promise<void> {
  get().toast(`Импорт: ${paths.length > 1 ? 'папка' : paths[0].split(/[\\/]/).pop()}`, 'info')
  try {
    const outcome = await api.local.importPaths(paths)
    set({ importProgress: null })
    await get().refreshLibrary()

    const imported = outcome.tracks.length
    const withLyrics = outcome.lyrics.length
    if (imported === 0) {
      get().toast('Аудиофайлы не найдены', 'error')
    } else {
      const parts = [`Импортировано ${imported}`]
      if (withLyrics > 0) parts.push(`текстов: ${withLyrics}`)
      if (outcome.failed.length > 0) parts.push(`ошибок: ${outcome.failed.length}`)
      get().toast(parts.join(' · '), 'success')
    }
  } catch (error) {
    set({ importProgress: null })
    get().toast(`Ошибка импорта: ${errorMessage(error)}`, 'error')
  }
}

/* ------------------------------------------------------------------ */
/* Playback reset hook                                                 */
/* ------------------------------------------------------------------ */

let stopPlayback: () => void = () => {}

/**
 * The player registers a stopper here, so switching profiles can silence the
 * current track without the store importing `state/player.ts` (which imports
 * the store, and would be a cycle).
 */
export function registerPlaybackReset(fn: () => void): void {
  stopPlayback = fn
}

function stopPlaybackForProfileSwitch(): void {
  try {
    stopPlayback()
  } catch {
    /* the player may not be mounted yet */
  }
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function useTrack(id: string | null | undefined): Track | undefined {
  return useApp((state) => (id ? state.catalogIndex.get(id) : undefined))
}

export function useIsFavorite(trackId: string | null | undefined): boolean {
  return useApp((state) => (trackId ? state.favorites.has(trackId) : false))
}
