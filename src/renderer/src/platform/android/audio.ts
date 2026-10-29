/**
 * Media3 playback behind an `HTMLAudioElement`-shaped door.
 *
 * `state/player.ts` was written against the DOM element: it assigns `src`,
 * calls `play()`/`pause()`/`load()`, writes `currentTime`, and listens for
 * `loadedmetadata` and friends. Rather than fork all of that logic, this class
 * implements the same surface on top of the `NativePlayer` plugin, so the
 * queue, repeat, history and session restore keep working unchanged.
 *
 * Two things differ from the element and are handled here:
 *
 * - native playback lives in a foreground service, so it outlives the WebView;
 * - positions arrive as events (twice a second) instead of being read off the
 *   element, and seeks before the first `open` are queued.
 */

import { registerPlugin } from '@capacitor/core'
import type { AudioHints, PlatformAudio } from '../../lib/media'

interface NativeState {
  state?: 'idle' | 'buffering' | 'ready' | 'ended'
  playing?: boolean
  buffering?: boolean
  ended?: boolean
  position?: number
  duration?: number
  error?: string
}

interface NativePlayerBridge {
  open(options: {
    src: string
    id?: string
    title?: string
    artist?: string
    album?: string
    artwork?: string
  }): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  seek(options: { position: number }): Promise<void>
  stop(): Promise<void>
  setVolume(options: { volume: number }): Promise<void>
  addListener(event: 'state', cb: (state: NativeState) => void): Promise<{ remove: () => void }>
  addListener(
    event: 'time',
    cb: (time: { position: number; duration: number }) => void
  ): Promise<{ remove: () => void }>
}

const NativePlayer = registerPlugin<NativePlayerBridge>('NativePlayer')

/** ExoPlayer wants a real URI, not the WebView's local server URL. */
function nativeSource(url: string): string {
  const marker = '/_capacitor_file_/'
  const index = url.indexOf(marker)
  if (index < 0) return url
  try {
    return `file://${decodeURIComponent(url.slice(index + marker.length - 1))}`
  } catch {
    return url
  }
}

type Listener = (event: unknown) => void

class NativeAudio {
  /* DOM-ish surface used by the player store. */
  preload = 'auto'
  autoplay = false
  paused = true
  duration = Number.NaN
  error: { code: number } | null = null

  private level = 1
  private isMuted = false

  private url = ''
  private opened = ''
  private opening: Promise<void> | null = null
  private hints: AudioHints = {}
  private position = 0
  private pendingSeek: number | null = null
  private listeners = new Map<string, Set<Listener>>()

  constructor() {
    void NativePlayer.addListener('state', (state) => this.onState(state))
    void NativePlayer.addListener('time', ({ position, duration }) => this.onTime(position, duration))
  }

  get src(): string {
    return this.url
  }

  set src(value: string) {
    const next = value ?? ''
    if (next === this.url) return
    this.url = next
    this.error = null
  }

  get currentTime(): number {
    return this.position
  }

  set currentTime(value: number) {
    this.position = value
    if (!this.url) return
    if (this.opened !== this.url) {
      this.pendingSeek = value
      return
    }
    void NativePlayer.seek({ position: value })
  }

  describe(hints: AudioHints): void {
    this.hints = hints
  }

  /** Volume and mute share one native level. */
  get volume(): number {
    return this.level
  }

  set volume(value: number) {
    this.level = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
    this.applyLevel()
  }

  get muted(): boolean {
    return this.isMuted
  }

  set muted(value: boolean) {
    this.isMuted = Boolean(value)
    this.applyLevel()
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn)
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.url = ''
  }

  /** Loads the current source without starting it. */
  load(): void {
    if (!this.url) {
      this.reset()
      return
    }
    void this.ensureOpen().catch(() => undefined)
  }

  async play(): Promise<void> {
    await this.ensureOpen()
    await NativePlayer.play()
    this.paused = false
  }

  pause(): void {
    this.paused = true
    void NativePlayer.pause()
  }

  /* ------------------------------------------------------------------ */
  /* Native events                                                       */
  /* ------------------------------------------------------------------ */

  private onState(state: NativeState): void {
    if (state.error) {
      this.error = { code: 4 }
      this.dispatch('error')
      return
    }

    if (typeof state.position === 'number') this.position = state.position
    if (typeof state.duration === 'number' && state.duration > 0 && state.duration !== this.duration) {
      this.duration = state.duration
      this.dispatch('loadedmetadata')
      this.dispatch('durationchange')
    }

    if (state.ended) {
      this.paused = true
      this.dispatch('pause')
      this.dispatch('ended')
      return
    }

    if (state.playing) {
      this.paused = false
      this.dispatch('play')
      this.dispatch('playing')
    } else {
      this.paused = true
      this.dispatch('pause')
    }

    this.dispatch(state.buffering ? 'waiting' : 'canplay')
  }

  private onTime(position: number, duration: number): void {
    this.position = position
    if (duration > 0 && duration !== this.duration) {
      this.duration = duration
      this.dispatch('durationchange')
    }
    this.dispatch('timeupdate')
  }

  private dispatch(type: string): void {
    const set = this.listeners.get(type)
    if (!set || set.size === 0) return
    for (const fn of [...set]) {
      try {
        fn({ type, target: this })
      } catch {
        /* a broken listener must not stop playback */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Opening                                                             */
  /* ------------------------------------------------------------------ */

  private ensureOpen(): Promise<void> {
    if (!this.url) return Promise.reject(new Error('У трека нет ссылки на аудио'))
    if (this.opened === this.url && this.opening) return this.opening

    const url = this.url
    const hints = this.hints
    this.opened = url
    this.error = null
    this.duration = Number.NaN

    this.opening = NativePlayer.open({
      src: nativeSource(url),
      id: url,
      title: hints.title,
      artist: hints.artist,
      album: hints.album,
      artwork: hints.artwork ? nativeSource(hints.artwork) : undefined
    })
      .then(() => {
        if (this.pendingSeek != null) {
          const target = this.pendingSeek
          this.pendingSeek = null
          this.position = target
          void NativePlayer.seek({ position: target })
        }
      })
      .catch((error: unknown) => {
        this.opened = ''
        this.opening = null
        this.error = { code: 4 }
        throw error
      })

    return this.opening
  }

  private reset(): void {
    this.opened = ''
    this.opening = null
    this.pendingSeek = null
    this.position = 0
    this.duration = Number.NaN
    this.paused = true
    void NativePlayer.stop()
  }

  /** Volume and mute share one native level. */
  private applyLevel(): void {
    void NativePlayer.setVolume({ volume: this.isMuted ? 0 : this.level })
  }
}

export function createNativeAudio(): PlatformAudio {
  return new NativeAudio() as unknown as PlatformAudio
}
