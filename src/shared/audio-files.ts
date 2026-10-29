/**
 * File-name rules shared by the desktop importer and the Android one.
 *
 * Both platforms receive a list of files from a picker and must agree on what
 * counts as audio, what a "song" is (a file name without its extension, so two
 * formats of one track collide on purpose), and what a sidecar looks like.
 */

export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.aiff',
  '.aif',
  '.wma',
  '.ape',
  '.mpc',
  '.wv'
])

export const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

/** Lower-case extension of a path or a bare file name, including the dot. */
export function extensionOf(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

export function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(name))
}

export function isCoverFile(name: string): boolean {
  return COVER_EXTENSIONS.has(extensionOf(name))
}

export function isLyricsFile(name: string): boolean {
  return extensionOf(name) === '.lrc'
}

/** File name without its path and extension, folded to lower case. */
export function songKey(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const ext = extensionOf(base)
  return (ext ? base.slice(0, -ext.length) : base).toLowerCase()
}

/** File name without the directories, as the user sees it. */
export function baseName(name: string): string {
  return String(name ?? '').split(/[\\/]/).pop() ?? ''
}
