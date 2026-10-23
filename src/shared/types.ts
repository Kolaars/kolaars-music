/**
 * Shared domain model for Kolaars Music.
 *
 * This file is imported by both the Electron main process and the renderer,
 * so it must stay free of any runtime dependency on Node or the DOM.
 */

/* ------------------------------------------------------------------ */
/* Tracks                                                              */
/* ------------------------------------------------------------------ */

/** Where a track came from. Drives how we resolve its audio + artwork. */
export type TrackSource =
  /** Shipped with the app in `data/seed-catalog.json` (an archive.org reference). */
  | 'seed'
  /** Discovered at runtime through an online provider (e.g. archive.org search). */
  | 'online'
  /** Imported from the user's disk. */
  | 'local'
  /**
   * Added from a pasted or imported track list (see `shared/tracklist.ts`).
   * Entry may carry metadata only — such a track shows its lyrics but has no
   * audio of its own.
   */
  | 'list'
  /**
   * Played through an external service's own official player (YouTube IFrame
   * Player, SoundCloud Widget). The app never receives the audio stream: it
   * only embeds the provider's player and drives it through its public API.
   */
  | 'external'

/** A playable item. */
export interface Track {
  id: string
  title: string
  artist: string
  album?: string | null
  year?: number | null
  genres?: string[]
  /** Duration in seconds, when known. */
  duration?: number | null
  /** Absolute URL or local path to cover art. */
  artwork?: string | null
  source: TrackSource
  /** Absolute URL or local path used by the `<audio>` element. */
  streamUrl: string
  /**
   * Provider identifier. For archive.org this is the item identifier,
   * used to lazily resolve the real stream URL and full metadata.
   */
  identifier?: string | null
  /**
   * Set when the track is played by an embedded, official provider player
   * instead of the app's own `<audio>` element.
   */
  external?: ExternalRef | null
  /** Absolute path on disk for locally imported tracks. */
  filePath?: string | null
  /** Human readable license, e.g. "Public Domain", "CC BY 4.0". */
  license?: string | null
  licenseUrl?: string | null
  /** Landing page of the original item (provenance / attribution). */
  sourceUrl?: string | null
  /** Whether the audio is cached on disk for offline playback. */
  offline?: boolean
  /** Epoch ms when the track entered the user's library. */
  addedAt?: number | null
}

/** A track plus everything needed to render one row of a track list. */
export interface TrackListItem extends Track {
  favorite: boolean
  /** True when lyrics exist locally for this track. */
  hasLyrics: boolean
}

/** Services whose official embeddable player the app can drive. */
export type ExternalProvider = 'youtube' | 'soundcloud'

/**
 * Everything needed to load one item in the provider's own player. The audio
 * itself never passes through the app.
 */
export interface ExternalRef {
  provider: ExternalProvider
  /** Provider-side id: a YouTube video id or a SoundCloud track id. */
  id: string
  /** Canonical public page, also used as the embed target. */
  pageUrl: string
  /**
   * Whether the provider allows this item to be played in its embedded
   * player. YouTube returns this as `status.embeddable`; `false` means the
   * uploader disabled embedding and the official player will refuse to play.
   * `undefined` means the provider does not report it (or the track was saved
   * before this field existed).
   */
  embeddable?: boolean
}

/** Per-provider connection state shown on the "Источники" screen. */
export interface SourceProviderState {
  /** A key/client id is stored in the encrypted credential store. */
  configured: boolean
  /** The provider is switched on in Settings. */
  enabled: boolean
}

export type SourcesStatus = Record<ExternalProvider, SourceProviderState>

/* ------------------------------------------------------------------ */
/* Discord Rich Presence                                               */
/* ------------------------------------------------------------------ */

/**
 * A snapshot of what is playing, sent from the renderer to the main process.
 * The main process owns the Discord connection; the renderer only describes
 * the current track.
 */
export interface DiscordPresence {
  title: string
  artist: string
  album?: string | null
  /** Playback position in seconds when the snapshot was taken. */
  position?: number | null
  duration?: number | null
  playing: boolean
  /**
   * Public https cover URL. Discord fetches artwork itself, so a local file
   * path or the kmedia:// scheme cannot be used here; those tracks stay without
   * an image unless the Discord application provides a fallback asset.
   */
  artworkUrl?: string | null
  /**
   * Public direct file URL. Set only for tracks the app may download
   * (Internet Archive / bundled open catalog), never for external players.
   */
  downloadUrl?: string | null
  /** Public landing page for attribution or for services without downloads. */
  sourceUrl?: string | null
  /** Explicit button label when `sourceUrl` is not the track's own page. */
  sourceLabel?: string | null
  /** Public download page for Kolaars Music itself, used when a slot is free. */
  appUrl?: string | null
  appLabel?: string | null
  /** Human-readable service name, e.g. "YouTube Music". */
  provider?: string | null
}

export type DiscordRpcState =
  | 'disabled'
  | 'missing-client-id'
  | 'connecting'
  | 'connected'
  | 'error'

export interface DiscordRpcStatus {
  state: DiscordRpcState
  /** Human-readable explanation shown under the settings toggle. */
  error?: string | null
}

/** A search request against one external provider. */
export interface SourceSearchQuery extends SearchQuery {
  provider: ExternalProvider
}

/* ------------------------------------------------------------------ */
/* Lyrics                                                              */
/* ------------------------------------------------------------------ */

/** A single timed lyric line (LRC). `time` is in seconds. */
export interface LyricLine {
  time: number
  text: string
  /** Optional end timestamp for word/line-accurate karaoke. */
  end?: number
}

export type LyricsOrigin =
  | 'user'
  | 'lrc-file'
  | 'pack'
  | 'lrclib'
  | 'wikisource'

export interface Lyrics {
  trackId: string
  /** Plain, newline separated text. Always present, even for synced lyrics. */
  plain: string
  /** Timed lines. Absent when only a plain text is known. */
  synced?: LyricLine[] | null
  /** Free-form metadata embedded in the LRC tag section. */
  meta?: Record<string, string>
  origin: LyricsOrigin
  /** Provider name for online lyrics, e.g. "LRCLIB" or "Wikisource". */
  provider?: string | null
  language?: string | null
  updatedAt: number
}

/** Result of an online lyrics lookup, before the user decides to keep it. */
export interface LyricsCandidate extends Lyrics {
  /** Confidence/quality hint used to rank candidates. */
  score: number
}

/* ------------------------------------------------------------------ */
/* Playlists, queue, favourites                                        */
/* ------------------------------------------------------------------ */

export interface Playlist {
  id: string
  name: string
  description?: string | null
  /** Ordered list of track ids. */
  trackIds: string[]
  /** Generated from a rule rather than hand-curated. */
  smart?: boolean
  createdAt: number
  updatedAt: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueItem {
  /** Unique per queue entry so the same track can appear twice. */
  uid: string
  trackId: string
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'dark' | 'light' | 'system'

export interface Settings {
  theme: ThemeMode
  /** Accent colour as a hex string. */
  accent: string
  /** Cross-fade between tracks, in seconds (0 = off). */
  crossfade: number
  /** Remember volume/queue/position between sessions. */
  resumeSession: boolean
  /** Prefer the highest quality stream the provider offers. */
  preferLossless: boolean
  /** Allow network calls to online providers. */
  onlineProviders: boolean
  /** Provider toggles. */
  providers: {
    archive: boolean
    lrclib: boolean
    wikisource: boolean
    youtube: boolean
    soundcloud: boolean
  }
  /** Normalise loudness across tracks. */
  normalizeLoudness: boolean
  /** Directory used for offline downloads. Empty = app default. */
  downloadDir: string
  /** Replay gain-style volume trim in dB, applied to every track. */
  volumeTrim: number
  /** Show a desktop notification when the track changes. */
  notifications: boolean
  /** Show the current track in Discord Rich Presence. */
  discordRpc: boolean
  /**
   * Discord Application ID used for Rich Presence. This is a public identifier,
   * not a bot token or client secret, and is safe to keep in the settings file.
   */
  discordRpcClientId: string
  /**
   * Order in which local formats are preferred, best first. When the same song
   * sits on disk in several formats, only the highest ranked one is imported.
   */
  formatPriority: string[]
}

/* ------------------------------------------------------------------ */
/* Session (persisted playback state)                                  */
/* ------------------------------------------------------------------ */

export interface SessionState {
  trackId: string | null
  position: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  queue: QueueItem[]
  /** Index into `queue` of the current track. */
  queueIndex: number
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export interface SearchQuery {
  text: string
  page?: number
  pageSize?: number
  /** Restrict to a provider collection, e.g. an archive.org collection id. */
  collection?: string | null
}

export interface SearchResultPage<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

export interface ArchiveCollection {
  id: string
  title: string
  description: string
  /** Sort used by the archive.org advanced search. */
  sort?: string
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

/**
 * A local profile: one self-contained library (tracks, playlists, favourites,
 * lyrics, covers and downloads) under its own directory. There are no accounts
 * and no server — profiles simply let several people, or several collections,
 * share one installation without seeing each other's data.
 */
export interface Profile {
  id: string
  name: string
  createdAt: number
}

/** The small registry file (`profiles.json`) that lives beside the profiles. */
export interface ProfilesRegistry {
  version: number
  activeId: string
  profiles: Profile[]
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export interface PersistedDb {
  version: number
  settings: Settings
  /** User-added tracks, keyed by id (imported files + saved online tracks). */
  tracks: Record<string, Track>
  playlists: Playlist[]
  favorites: string[]
  lyrics: Record<string, Lyrics>
  history: { trackId: string; at: number }[]
  session: SessionState
  /** Paths already imported, used to avoid duplicates. */
  importedPaths: string[]
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
