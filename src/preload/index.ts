/**
 * Preload bridge.
 *
 * The renderer has no direct access to Node or Electron: this file exposes a
 * narrow, typed API on `window.kolaars`. Every call unwraps the
 * `IpcResult<T>` envelope, turning `{ ok: false, error }` into a thrown Error so
 * the UI can use plain `try/catch`.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { CH, EV, type MediaCommand } from '@shared/ipc'
import type {
  ImportListOutcome,
  ImportListRequest,
  PlaylistFileFormat
} from '@shared/tracklist'
import type {
  ArchiveCollection,
  ExternalProvider,
  Lyrics,
  LyricsCandidate,
  Playlist,
  Profile,
  SearchQuery,
  SearchResultPage,
  Settings,
  SessionState,
  SourceSearchQuery,
  SourcesStatus,
  Track
} from '@shared/types'

type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcEnvelope<T> | T
  if (result && typeof result === 'object' && 'ok' in (result as object)) {
    const envelope = result as IpcEnvelope<T>
    if (envelope.ok) return envelope.data
    throw new Error(envelope.error)
  }
  return result as T
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/* ------------------------------------------------------------------ */

export interface DownloadRecord {
  trackId: string
  title: string
  artist: string
  filePath: string
  bytesTotal: number
  bytesDone: number
  status: 'queued' | 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface ImportOutcome {
  tracks: Track[]
  lyrics: Lyrics[]
  skipped: string[]
  failed: { path: string; error: string }[]
  /** Files left out because the same song is already there in a better format. */
  duplicates: { path: string; kept: string }[]
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  downloadsDir: string
  seedTracks: number
  profile: { id: string; name: string } | null
  lyricsPack: { name: string; version: string; license: string; note: string; count: number }
}

export interface ProfilesState {
  activeId: string
  profiles: Profile[]
}

export interface BundledSong {
  id: string
  title: string
  artist: string
  year?: number
  language?: string
  license: string
}

export interface WikisourceHit {
  title: string
  pageId: number
  snippet: string
  url: string
}

export interface ShelfDescriptor {
  id: string
  title: string
  subtitle: string
  query: string
}

export interface LibrarySnapshot {
  settings: Settings
  playlists: Playlist[]
  favorites: string[]
  tracks: Track[]
  history: { trackId: string; at: number }[]
  session: SessionState
  lyricsIds: string[]
}

const api = {
  app: {
    info: (): Promise<AppInfo> => invoke(CH.appInfo),
    openExternal: (url: string): Promise<boolean> => invoke(CH.openExternal, url),
    minimize: (): Promise<boolean> => invoke(CH.windowMinimize),
    toggleMaximize: (): Promise<boolean> => invoke(CH.windowToggleMaximize),
    close: (): Promise<boolean> => invoke(CH.windowClose),
    onWindowState: (cb: (state: { maximized: boolean }) => void): (() => void) =>
      subscribe(EV.windowState, cb),
    onMediaCommand: (cb: (command: MediaCommand) => void): (() => void) =>
      subscribe(EV.mediaCommand, cb),
    onNavigate: (cb: (route: string) => void): (() => void) => subscribe(EV.navigate, cb)
  },

  store: {
    load: (): Promise<LibrarySnapshot> => invoke(CH.dbLoad),
    saveSettings: (patch: Partial<Settings>): Promise<Settings> => invoke(CH.dbSettings, patch),
    saveSession: (patch: Partial<SessionState>): Promise<SessionState> => invoke(CH.dbSession, patch)
  },

  profiles: {
    list: (): Promise<ProfilesState> => invoke(CH.profilesList),
    create: (name: string): Promise<ProfilesState> => invoke(CH.profilesCreate, name),
    rename: (id: string, name: string): Promise<ProfilesState> => invoke(CH.profilesRename, id, name),
    remove: (id: string): Promise<ProfilesState> => invoke(CH.profilesDelete, id),
    switch: (id: string): Promise<ProfilesState> => invoke(CH.profilesSwitch, id)
  },

  catalog: {
    seed: (): Promise<Track[]> => invoke(CH.catalogSeed),
    genres: (): Promise<{ name: string; count: number }[]> => invoke(CH.catalogGenres),
    shelves: (): Promise<ShelfDescriptor[]> => invoke(CH.archiveShelves),
    collections: (): Promise<ArchiveCollection[]> => invoke(CH.archiveCollections)
  },

  library: {
    list: (): Promise<{ tracks: Track[]; favorites: string[]; lyricsIds: string[] }> =>
      invoke(CH.libraryList),
    addTrack: (track: Track): Promise<Track> => invoke(CH.trackAdd, track),
    updateTrack: (id: string, patch: Partial<Track>): Promise<Track | null> =>
      invoke(CH.trackUpdate, id, patch),
    removeTrack: (id: string): Promise<boolean> => invoke(CH.trackRemove, id),
    toggleFavorite: (trackId: string): Promise<string[]> => invoke(CH.favoritesToggle, trackId),
    addHistory: (trackId: string): Promise<number> => invoke(CH.historyAdd, trackId),
    clearHistory: (): Promise<boolean> => invoke(CH.historyClear)
  },

  playlists: {
    create: (name: string, trackIds?: string[]): Promise<Playlist> =>
      invoke(CH.playlistCreate, name, trackIds ?? []),
    update: (
      id: string,
      patch: Partial<Pick<Playlist, 'name' | 'description'>>
    ): Promise<Playlist | null> => invoke(CH.playlistUpdate, id, patch),
    remove: (id: string): Promise<boolean> => invoke(CH.playlistDelete, id),
    addTracks: (id: string, trackIds: string[]): Promise<Playlist | null> =>
      invoke(CH.playlistAddTracks, id, trackIds),
    removeTrack: (id: string, trackId: string): Promise<Playlist | null> =>
      invoke(CH.playlistRemoveTrack, id, trackId),
    reorder: (id: string, from: number, to: number): Promise<Playlist | null> =>
      invoke(CH.playlistReorder, id, from, to),
    exportFile: (
      id: string,
      format: PlaylistFileFormat
    ): Promise<{ path: string; count: number } | null> => invoke(CH.playlistExport, id, format)
  },

  tracklist: {
    pickFile: (): Promise<{ path: string; text: string } | null> => invoke(CH.listPickFile),
    run: (request: ImportListRequest): Promise<ImportListOutcome> => invoke(CH.listImport, request)
  },

  lyrics: {
    get: (
      track: Pick<Track, 'id' | 'title' | 'artist'>
    ): Promise<{ saved: Lyrics | null; bundled: Lyrics | null }> => invoke(CH.lyricsGet, track),
    save: (lyrics: Lyrics): Promise<Lyrics> => invoke(CH.lyricsSave, lyrics),
    remove: (trackId: string): Promise<boolean> => invoke(CH.lyricsDelete, trackId),
    search: (track: Track): Promise<LyricsCandidate[]> => invoke(CH.lyricsSearch, track),
    sources: (
      query: string
    ): Promise<{ bundled: BundledSong[]; wikisource: WikisourceHit[] }> =>
      invoke(CH.lyricsSources, query),
    bundledSearch: (query: string): Promise<BundledSong[]> => invoke(CH.lyricsBundledSearch, query),
    bundledGet: (songId: string, trackId: string): Promise<Lyrics | null> =>
      invoke(CH.lyricsBundledGet, songId, trackId),
    packInfo: (): Promise<{
      name: string
      version: string
      license: string
      note: string
      count: number
      songs: BundledSong[]
    }> => invoke(CH.lyricsPackInfo),
    wikisourceFetch: (title: string, trackId: string): Promise<Lyrics | null> =>
      invoke(CH.lyricsWikisourceFetch, title, trackId),
    importLrc: (track: Track): Promise<Lyrics | null> => invoke(CH.lyricsImportLrc, track),
    exportLrc: (track: Track, lyrics: Lyrics): Promise<string | null> =>
      invoke(CH.lyricsExportLrc, track, lyrics),
    draftTimings: (plain: string, duration: number): Promise<{ time: number; text: string }[]> =>
      invoke(CH.lyricsDraftTimings, plain, duration)
  },

  archive: {
    search: (query: SearchQuery): Promise<SearchResultPage<Track>> => invoke(CH.archiveSearch, query),
    shelfTracks: (shelfId: string, limit?: number): Promise<Track[]> =>
      invoke(CH.archiveShelfTracks, shelfId, limit ?? 20),
    resolve: (trackId: string): Promise<Track | null> => invoke(CH.archiveResolve, trackId),
    item: (
      identifier: string
    ): Promise<{
      tracks: Track[]
      album: string
      artist: string
      artwork: string
      license: string
    } | null> => invoke(CH.archiveItem, identifier)
  },

  sources: {
    status: (): Promise<SourcesStatus> => invoke(CH.sourcesStatus),
    setCredential: (provider: ExternalProvider, value: string): Promise<SourcesStatus> =>
      invoke(CH.sourcesSetCredential, provider, value),
    clearCredential: (provider: ExternalProvider): Promise<SourcesStatus> =>
      invoke(CH.sourcesClearCredential, provider),
    search: (query: SourceSearchQuery): Promise<SearchResultPage<Track>> =>
      invoke(CH.sourcesSearch, query),
    resolve: (trackId: string): Promise<Track | null> => invoke(CH.sourcesResolve, trackId)
  },

  local: {
    pickFiles: (): Promise<string[]> => invoke(CH.localPickFiles),
    pickFolder: (): Promise<string | null> => invoke(CH.localPickFolder),
    pickDownloadDir: (): Promise<string | null> => invoke(CH.localPickDownloadDir),
    importPaths: (paths: string[]): Promise<ImportOutcome> => invoke(CH.localImport, paths),
    reveal: (filePath: string): Promise<boolean> => invoke(CH.localReveal, filePath)
  },

  downloads: {
    start: (track: Track): Promise<DownloadRecord> => invoke(CH.downloadStart, track),
    list: (): Promise<DownloadRecord[]> => invoke(CH.downloadList),
    cancel: (trackId: string): Promise<boolean> => invoke(CH.downloadCancel, trackId),
    remove: (trackId: string): Promise<boolean> => invoke(CH.downloadRemove, trackId),
    reveal: (trackId: string): Promise<boolean> => invoke(CH.downloadReveal, trackId)
  },

  events: {
    onDownloadProgress: (cb: (record: DownloadRecord) => void): (() => void) =>
      subscribe(EV.downloadProgress, cb),
    onImportProgress: (cb: (progress: { done: number; total: number; current: string }) => void): (() => void) =>
      subscribe(EV.importProgress, cb)
  }
}

export type KolaarsApi = typeof api

contextBridge.exposeInMainWorld('kolaars', api)
