/**
 * The audio element factory.
 *
 * The desktop build plays through a plain `HTMLAudioElement`. On Android that
 * element lives inside the WebView, which the system may kill once the app is
 * in the background, and it cannot show a media notification. The Android boot
 * swaps in a shim backed by Media3 (see `platform/android/audio.ts`), while
 * everything above — queue, repeat, session restore — stays identical.
 */

export interface AudioHints {
  title?: string
  artist?: string
  album?: string
  artwork?: string
}

/** The extra method the native shim understands; the DOM element has none. */
export interface PlatformAudio extends HTMLAudioElement {
  describe?(hints: AudioHints): void
}

let factory: () => PlatformAudio = () => new Audio()

export function setAudioFactory(next: () => PlatformAudio): void {
  factory = next
}

export function createAudio(): PlatformAudio {
  return factory()
}

/** Tells a native player what the notification should say. */
export function describeAudio(audio: HTMLAudioElement | null, hints: AudioHints): void {
  ;(audio as PlatformAudio | null)?.describe?.(hints)
}
