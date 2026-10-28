/**
 * The renderer-facing API contract.
 *
 * `window.kolaars` is the single bridge between the UI and whatever runtime is
 * hosting it: the Electron preload on desktop, or `createAndroidApi()` inside
 * the Capacitor WebView. Keeping the contract in `shared` means both sides are
 * checked against exactly the same shape.
 */

import type { MediaCommand } from './ipc'
import type { ImportListOutcome, ImportListRequest, PlaylistFileFormat } from './tracklist'
import type {
  ArchiveCollection,
  DiscordPresence,
  DiscordRpcStatus,
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
} from './types'

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

export interface KolaarsApi {
  app: {
    info: () => Promise<AppInfo>
    openExternal: (url: string) => Promise<boolean>
    minimize: () => Promise<boolean>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<boolean>
    onWindowState: (cb: (state: { maximized: boolean }) => void) => () => void
    onMediaCommand: (cb: (command: MediaCommand) => void) => () => void
    onNavigate: (cb: (route: string) => void) => () => void
  }

  discord: {
    configure: (enabled: boolean, clientId: string) => Promise<DiscordRpcStatus>
    setActivity: (presence: DiscordPresence | null) => Promise<DiscordRpcStatus>
    status: () => Promise<DiscordRpcStatus>
    onStatus: (cb: (status: DiscordRpcStatus) => void) => () => void
  }

  store: {
    load: () => Promise<LibrarySnapshot>
    saveSettings: (patch: Partial<Settings>) => Promise<Settings>
    saveSession: (patch: Partial<SessionState>) => Promise<SessionState>
  }

  profiles: {
    list: () => Promise<ProfilesState>
    create: (name: string) => Promise<ProfilesState>
    rename: (id: string, name: string) => Promise<ProfilesState>
    remove: (id: string) => Promise<ProfilesState>
    switch: (id: string) => Promise<ProfilesState>
  }

  catalog: {
    seed: () => Promise<Track[]>
    genres: () => Promise<{ name: string; count: number }[]>
    shelves: () => Promise<ShelfDescriptor[]>
    collections: () => Promise<ArchiveCollection[]>
  }

  library: {
    list: () => Promise<{ tracks: Track[]; favorites: string[]; lyricsIds: string[] }>
    addTrack: (track: Track) => Promise<Track>
    updateTrack: (id: string, patch: Partial<Track>) => Promise<Track | null>
    removeTrack: (id: string) => Promise<boolean>
    toggleFavorite: (trackId: string) => Promise<string[]>
    addHistory: (trackId: string) => Promise<number>
    clearHistory: () => Promise<boolean>
  }

  playlists: {
    create: (name: string, trackIds?: string[]) => Promise<Playlist>
    update: (
      id: string,
      patch: Partial<Pick<Playlist, 'name' | 'description'>>
    ) => Promise<Playlist | null>
    remove: (id: string) => Promise<boolean>
    addTracks: (id: string, trackIds: string[]) => Promise<Playlist | null>
    removeTrack: (id: string, trackId: string) => Promise<Playlist | null>
    reorder: (id: string, from: number, to: number) => Promise<Playlist | null>
    exportFile: (
      id: string,
      format: PlaylistFileFormat
    ) => Promise<{ path: string; count: number } | null>
  }

  tracklist: {
    pickFile: () => Promise<{ path: string; text: string } | null>
    run: (request: ImportListRequest) => Promise<ImportListOutcome>
  }

  lyrics: {
    get: (
      track: Pick<Track, 'id' | 'title' | 'artist'>
    ) => Promise<{ saved: Lyrics | null; bundled: Lyrics | null }>
    save: (lyrics: Lyrics) => Promise<Lyrics>
    remove: (trackId: string) => Promise<boolean>
    search: (track: Track) => Promise<LyricsCandidate[]>
    sources: (
      query: string
    ) => Promise<{ bundled: BundledSong[]; wikisource: WikisourceHit[] }>
    bundledSearch: (query: string) => Promise<BundledSong[]>
    bundledGet: (songId: string, trackId: string) => Promise<Lyrics | null>
    packInfo: () => Promise<{
      name: string
      version: string
      license: string
      note: string
      count: number
      songs: BundledSong[]
    }>
    wikisourceFetch: (title: string, trackId: string) => Promise<Lyrics | null>
    importLrc: (track: Track) => Promise<Lyrics | null>
    exportLrc: (track: Track, lyrics: Lyrics) => Promise<string | null>
    draftTimings: (plain: string, duration: number) => Promise<{ time: number; text: string }[]>
  }

  archive: {
    search: (query: SearchQuery) => Promise<SearchResultPage<Track>>
    shelfTracks: (shelfId: string, limit?: number) => Promise<Track[]>
    resolve: (trackId: string) => Promise<Track | null>
    item: (identifier: string) => Promise<{
      tracks: Track[]
      album: string
      artist: string
      artwork: string
      license: string
    } | null>
  }

  sources: {
    status: () => Promise<SourcesStatus>
    setCredential: (provider: ExternalProvider, value: string) => Promise<SourcesStatus>
    clearCredential: (provider: ExternalProvider) => Promise<SourcesStatus>
    search: (query: SourceSearchQuery) => Promise<SearchResultPage<Track>>
    resolve: (trackId: string) => Promise<Track | null>
  }

  local: {
    pickFiles: () => Promise<string[]>
    pickFolder: () => Promise<string | null>
    pickDownloadDir: () => Promise<string | null>
    importPaths: (paths: string[]) => Promise<ImportOutcome>
    reveal: (filePath: string) => Promise<boolean>
  }

  downloads: {
    start: (track: Track) => Promise<DownloadRecord>
    list: () => Promise<DownloadRecord[]>
    cancel: (trackId: string) => Promise<boolean>
    remove: (trackId: string) => Promise<boolean>
    reveal: (trackId: string) => Promise<boolean>
  }

  events: {
    onDownloadProgress: (cb: (record: DownloadRecord) => void) => () => void
    onImportProgress: (cb: (progress: { done: number; total: number; current: string }) => void) => () => void
  }
}
