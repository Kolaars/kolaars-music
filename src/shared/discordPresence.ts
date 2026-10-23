/**
 * Builds the small snapshot of a track that Discord is allowed to show.
 *
 * Discord buttons can only open public URLs, not run an action inside the
 * player. The "download" URL is therefore attached only to open catalog tracks
 * whose audio is served as a direct public file. External providers (YouTube
 * Music, SoundCloud) get their public page instead; local files have no public
 * page, so their button opens a YouTube Music search by artist and title.
 */

import type { DiscordPresence, Track } from './types'
import { externalOpenUrl, youtubeMusicSearchUrl } from './external'

/** Public installer page for Kolaars Music itself. */
export const APP_DOWNLOAD_URL = 'https://github.com/Kolaars/kolaars-music/releases/latest'
export const APP_BUTTON_LABEL = 'Скачать Kolaars Music'

function publicUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 512) return null
  return /^https?:\/\//i.test(value) ? value : null
}

function clipLabel(value: string | null | undefined): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  return text.length <= 32 ? text : text.slice(0, 31) + '…'
}

/**
 * Discord fetches rich-presence artwork through its own CDN, so only an
 * absolute https URL is usable. Local covers are file paths or kmedia:// URLs
 * and are deliberately dropped instead of leaking a machine-specific path.
 */
function publicArtwork(track: Track): string | null {
  if (track.source === 'local') return null
  const url = publicUrl(track.artwork)
  return url && /^https:\/\//i.test(url) ? url : null
}

function providerLabel(track: Track): string | null {
  if (track.external) {
    return track.external.provider === 'youtube' ? 'YouTube Music' : 'SoundCloud'
  }
  if (track.source === 'local') return 'Локальный файл'
  return null
}

/** A direct archive.org file is the only case where "Скачать" is honest. */
function downloadUrl(track: Track): string | null {
  if (track.external) return null
  if (track.source !== 'seed' && track.source !== 'online') return null
  return publicUrl(track.streamUrl)
}

export function buildDiscordPresence(
  track: Track,
  playback: { position: number; duration: number; playing: boolean }
): DiscordPresence {
  const external = track.external
  const sourceUrl = publicUrl(external ? externalOpenUrl(track) : track.sourceUrl)
  // A file on disk has no public page. Point the button at a YouTube Music
  // search instead, clearly labelled as a search rather than the same track.
  const searchUrl =
    !sourceUrl && track.source === 'local'
      ? youtubeMusicSearchUrl([track.artist, track.title].filter(Boolean).join(' '))
      : null
  return {
    title: track.title,
    artist: track.artist,
    album: track.album ?? null,
    position: Number.isFinite(playback.position) ? playback.position : 0,
    duration: Number.isFinite(playback.duration) ? playback.duration : null,
    playing: Boolean(playback.playing),
    artworkUrl: publicArtwork(track),
    downloadUrl: downloadUrl(track),
    sourceUrl: sourceUrl ?? searchUrl,
    sourceLabel: searchUrl ? 'Найти в YouTube Music' : null,
    appUrl: APP_DOWNLOAD_URL,
    appLabel: APP_BUTTON_LABEL,
    provider: providerLabel(track)
  }
}

export interface DiscordButton {
  label: string
  url: string
}

/**
 * Discord allows at most two buttons. Track-specific links come first, so a
 * source page is never displaced by promotion; the app's own download link
 * fills a free slot on local and external tracks.
 */
export function buildDiscordButtons(presence: DiscordPresence): DiscordButton[] {
  const buttons: DiscordButton[] = []
  const download = publicUrl(presence.downloadUrl)
  const source = publicUrl(presence.sourceUrl)
  const app = publicUrl(presence.appUrl)

  if (download) buttons.push({ label: 'Скачать', url: download })
  if (source && source !== download) {
    const label = download
      ? 'Источник'
      : clipLabel(presence.sourceLabel) ||
        (presence.provider ? clipLabel(`Открыть в ${presence.provider}`) : 'Открыть')
    buttons.push({ label, url: source })
  }
  if (buttons.length < 2 && app) {
    buttons.push({ label: clipLabel(presence.appLabel) || 'Kolaars Music', url: app })
  }
  return buttons.slice(0, 2)
}
