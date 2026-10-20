/**
 * Shared IPC channel names. Kept in one place so main and preload can never
 * drift apart.
 */
export const CH = {
  /* app */
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowState: 'window:state',

  /* db / library */
  dbLoad: 'db:load',
  dbSettings: 'db:settings:set',
  dbSession: 'db:session:set',
  trackAdd: 'track:add',
  trackRemove: 'track:remove',
  trackUpdate: 'track:update',
  libraryList: 'library:list',
  favoritesToggle: 'favorites:toggle',
  historyAdd: 'history:add',
  historyClear: 'history:clear',

  /* playlists */
  playlistCreate: 'playlist:create',
  playlistUpdate: 'playlist:update',
  playlistDelete: 'playlist:delete',
  playlistAddTracks: 'playlist:add-tracks',
  playlistRemoveTrack: 'playlist:remove-track',
  playlistReorder: 'playlist:reorder',
  playlistExport: 'playlist:export',

  /* track-list import */
  listPickFile: 'list:pick-file',
  listImport: 'list:import',

  /* lyrics */
  lyricsGet: 'lyrics:get',
  lyricsSave: 'lyrics:save',
  lyricsDelete: 'lyrics:delete',
  lyricsImportLrc: 'lyrics:import-lrc',
  lyricsExportLrc: 'lyrics:export-lrc',
  lyricsSearch: 'lyrics:search',
  lyricsSources: 'lyrics:sources',
  lyricsBundledSearch: 'lyrics:bundled-search',
  lyricsBundledGet: 'lyrics:bundled-get',
  lyricsPackInfo: 'lyrics:pack-info',
  lyricsWikisourceFetch: 'lyrics:wikisource-fetch',
  lyricsDraftTimings: 'lyrics:draft-timings',

  /* providers */
  archiveSearch: 'archive:search',
  archiveCollections: 'archive:collections',
  archiveShelves: 'archive:shelves',
  archiveShelfTracks: 'archive:shelf-tracks',
  archiveResolve: 'archive:resolve',
  archiveItem: 'archive:item',

  /* external sources (official players only) */
  sourcesStatus: 'sources:status',
  sourcesSetCredential: 'sources:set-credential',
  sourcesClearCredential: 'sources:clear-credential',
  sourcesSearch: 'sources:search',
  sourcesResolve: 'sources:resolve',

  /* local files */
  localPickFiles: 'local:pick-files',
  localPickFolder: 'local:pick-folder',
  localImport: 'local:import',
  localReveal: 'local:reveal',
  localPickDownloadDir: 'local:pick-download-dir',

  /* downloads */
  downloadStart: 'download:start',
  downloadCancel: 'download:cancel',
  downloadRemove: 'download:remove',
  downloadList: 'download:list',
  downloadReveal: 'download:reveal',

  /* profiles */
  profilesList: 'profiles:list',
  profilesCreate: 'profiles:create',
  profilesRename: 'profiles:rename',
  profilesDelete: 'profiles:delete',
  profilesSwitch: 'profiles:switch',

  /* seed catalog */
  catalogSeed: 'catalog:seed',
  catalogGenres: 'catalog:genres'
} as const

export type Channel = (typeof CH)[keyof typeof CH]

/* ------------------------------------------------------------------ */
/* Main -> renderer push events                                        */
/* ------------------------------------------------------------------ */

export const EV = {
  windowState: 'event:window-state',
  downloadProgress: 'event:download-progress',
  importProgress: 'event:import-progress',
  mediaCommand: 'event:media-command',
  navigate: 'event:navigate'
} as const

export type MediaCommand =
  | 'play-pause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'toggle-lyrics'
  | 'toggle-queue'
  | 'focus-search'
  | 'shuffle'
  | 'repeat'
  /* UI-side actions driven by the application menu */
  | 'import-files'
  | 'import-folder'
  | 'import-list'
  | 'new-playlist'
  | 'find-lyrics'

