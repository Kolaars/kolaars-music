/**
 * Playback engine.
 *
 * Owns a single HTMLAudioElement (created lazily, module scoped) and the queue.
 * Kept out of React on purpose: this store updates ~15x/second while playing, so
 * only the components that actually display progress subscribe to it.
 */

import { create } from 'zustand'
import { makeId } from '@shared/defaults'
import type { QueueItem, RepeatMode, Track } from '@shared/types'
import { errorMessage } from '../lib/api'
import { registerPlaybackReset, useApp } from './store'

const TICK_MS = 66 // ~15 fps: plenty for karaoke line highlighting and a seek bar

interface PlayerState {
  queue: QueueItem[]
  queueIndex: number
  currentId: string | null
  playing: boolean
  buffering: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  error: string | null

  /* actions */
  playTracks: (tracks: Track[], startIndex?: number) => void
  playQueue: (trackIds: string[], startIndex?: number) => void
  playTrack: (track: Track) => void
  playAt: (index: number) => void
  toggle: () => void
  play: () => void
  pause: () => void
  stop: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  skip: (delta: number) => void
  setVolume: (volume: number) => void
  adjustVolume: (delta: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  addToQueue: (track: Track, placement?: 'next' | 'end') => void
  removeFromQueue: (uid: string) => void
  reorderQueue: (from: number, to: number) => void
  clearQueue: () => void
  handleEnded: () => void
  dismissError: () => void
}

/* ------------------------------------------------------------------ */
/* Audio element                                                       */
/* ------------------------------------------------------------------ */

let audio: HTMLAudioElement | null = null
let tickHandle = 0
let lastTick = 0
let loadToken = 0
/** Saved order so turning shuffle off restores what the user actually queued. */
let unshuffled: QueueItem[] | null = null

function el(): HTMLAudioElement {
  if (audio) return audio
  const element = new Audio()
  element.preload = 'auto'
  element.autoplay = false

  element.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(element.duration)) {
      usePlayer.setState({ duration: element.duration })
    }
  })
  element.addEventListener('durationchange', () => {
    if (Number.isFinite(element.duration)) {
      usePlayer.setState({ duration: element.duration })
    }
  })
  element.addEventListener('playing', () => {
    usePlayer.setState({ playing: true, buffering: false })
    startTicker()
  })
  element.addEventListener('play', () => usePlayer.setState({ playing: true }))
  element.addEventListener('pause', () => {
    usePlayer.setState({ playing: false })
    stopTicker()
  })
  element.addEventListener('waiting', () => usePlayer.setState({ buffering: true }))
  element.addEventListener('canplay', () => usePlayer.setState({ buffering: false }))
  element.addEventListener('ended', () => usePlayer.getState().handleEnded())
  element.addEventListener('error', () => {
    if (!element.src) return
    const code = element.error?.code
    const message =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Формат не поддерживается или файл недоступен'
        : code === MediaError.MEDIA_ERR_NETWORK
          ? 'Сетевая ошибка при загрузке аудио'
          : 'Не удалось воспроизвести трек'
    usePlayer.setState({ error: message, buffering: false, playing: false })
    stopTicker()
  })

  audio = element
  return element
}

function startTicker(): void {
  if (tickHandle) return
  const tick = (now: number): void => {
    const element = audio
    if (!element) return
    if (now - lastTick >= TICK_MS) {
      lastTick = now
      const position = element.currentTime
      if (Math.abs(position - usePlayer.getState().position) > 0.02) {
        usePlayer.setState({ position })
      }
      const duration = element.duration
      if (Number.isFinite(duration) && duration > 0 && Math.abs(duration - usePlayer.getState().duration) > 0.5) {
        usePlayer.setState({ duration })
      }
    }
    tickHandle = requestAnimationFrame(tick)
  }
  tickHandle = requestAnimationFrame(tick)
}

function stopTicker(): void {
  if (!tickHandle) return
  cancelAnimationFrame(tickHandle)
  tickHandle = 0
}

/** Applies volume/mute to the element, using a perceptual curve. */
function applyVolume(volume: number, muted: boolean): void {
  const element = el()
  const effective = muted ? 0 : volume
  element.volume = Math.min(1, Math.max(0, effective))
  element.muted = muted
}

/**
 * `HTMLMediaElement.play()` rejects with `AbortError` whenever a newer `load()`
 * or `pause()` interrupts it — which happens constantly while skipping tracks.
 * That is normal churn, not a failure worth showing in a toast.
 */
function isBenignPlayError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name
  return name === 'AbortError'
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadCurrent(autoplay: boolean): Promise<void> {
  const token = ++loadToken
  const state = usePlayer.getState()
  const item = state.queue[state.queueIndex]
  const trackId = item?.trackId ?? null

  usePlayer.setState({ currentId: trackId, error: null, position: 0 })

  if (!trackId) {
    const element = el()
    element.removeAttribute('src')
    element.load()
    usePlayer.setState({ duration: 0, playing: false })
    return
  }

  const app = useApp.getState()
  let track = app.catalogIndex.get(trackId)

  if (!track) {
    // The track was deleted from the library while queued.
    usePlayer.setState({ error: 'Трек больше недоступен' })
    return
  }

  if (!track.streamUrl || track.duration == null) {
    usePlayer.setState({ buffering: true })
    const resolved = await app.ensureTrack(trackId)
    if (token !== loadToken) return // superseded by a newer request
    if (resolved) track = resolved
  }

  if (token !== loadToken) return

  if (!track.streamUrl) {
    usePlayer.setState({ buffering: false, error: 'Не удалось получить ссылку на аудио' })
    return
  }

  const element = el()
  if (element.src !== track.streamUrl) {
    element.src = track.streamUrl
  }
  if (track.duration) usePlayer.setState({ duration: track.duration })

  applyVolume(usePlayer.getState().volume, usePlayer.getState().muted)

  if (autoplay) {
    try {
      await element.play()
    } catch (error) {
      if (token !== loadToken || isBenignPlayError(error)) return
      // A real rejection means the stream could not start: surface it instead of
      // failing silently.
      usePlayer.setState({ playing: false, buffering: false, error: errorMessage(error) })
    }
  }
}

/* ------------------------------------------------------------------ */
/* Queue helpers                                                       */
/* ------------------------------------------------------------------ */

function toQueue(tracks: Track[]): QueueItem[] {
  return tracks.map((track) => ({ uid: makeId('q'), trackId: track.id }))
}

function shuffledFrom(queue: QueueItem[], index: number): QueueItem[] {
  const head = queue.slice(0, index + 1)
  const tail = queue.slice(index + 1)
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = tail[i]
    tail[i] = tail[j]
    tail[j] = swap
  }
  return [...head, ...tail]
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  queueIndex: -1,
  currentId: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeat: 'off',
  error: null,

  playTracks: (tracks, startIndex = 0) => {
    if (tracks.length === 0) return
    // Register the tracks first: the queue stores ids only, and the loader looks
    // them up in the catalog index.
    useApp.getState().cacheTracks(tracks)
    const index = Math.max(0, Math.min(startIndex, tracks.length - 1))
    let queue = toQueue(tracks)
    const shuffle = get().shuffle
    unshuffled = shuffle ? queue : null
    if (shuffle) queue = shuffledFrom(queue, index)
    set({ queue, queueIndex: index, shuffle })
    void loadCurrent(true)
  },

  playQueue: (trackIds, startIndex = 0) => {
    const app = useApp.getState()
    const tracks = trackIds
      .map((id) => app.catalogIndex.get(id))
      .filter((track): track is Track => Boolean(track))
    get().playTracks(tracks, startIndex)
  },

  playTrack: (track) => get().playTracks([track], 0),

  playAt: (index) => {
    const { queue } = get()
    if (index < 0 || index >= queue.length) return
    set({ queueIndex: index })
    void loadCurrent(true)
  },

  toggle: () => (get().playing ? get().pause() : get().play()),

  play: () => {
    const element = el()
    if (!element.src) {
      const { queue, queueIndex } = get()
      if (queue.length > 0 && queueIndex >= 0) {
        void loadCurrent(true)
        return
      }
      return
    }
    void element.play().catch((error: unknown) => {
      if (isBenignPlayError(error)) return
      set({ playing: false, error: errorMessage(error) })
    })
  },

  pause: () => {
    el().pause()
  },

  stop: () => {
    const element = el()
    element.pause()
    element.currentTime = 0
    set({ playing: false, position: 0 })
    stopTicker()
  },

  next: () => {
    const { queue, queueIndex, repeat } = get()
    if (queue.length === 0) return
    let index = queueIndex + 1
    if (index >= queue.length) {
      if (repeat === 'all') index = 0
      else {
        el().pause()
        set({ playing: false, position: get().duration })
        return
      }
    }
    set({ queueIndex: index })
    void loadCurrent(true)
  },

  previous: () => {
    const { queue, queueIndex, repeat, position } = get()
    if (queue.length === 0) return
    // Standard behaviour: restart the track unless we are near its beginning.
    if (position > 3) {
      get().seek(0)
      return
    }
    let index = queueIndex - 1
    if (index < 0) index = repeat === 'all' ? queue.length - 1 : 0
    set({ queueIndex: index })
    void loadCurrent(true)
  },

  seek: (seconds) => {
    const element = el()
    const duration = Number.isFinite(element.duration) ? element.duration : get().duration
    const target = Math.min(Math.max(0, seconds), duration || seconds)
    try {
      element.currentTime = target
    } catch {
      /* seeking before metadata is ready */
    }
    set({ position: target })
  },

  skip: (delta) => get().seek(get().position + delta),

  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume))
    applyVolume(clamped, get().muted)
    set({ volume: clamped, muted: clamped === 0 ? true : false })
  },

  adjustVolume: (delta) => {
    const next = Math.min(1, Math.max(0, get().volume + delta))
    applyVolume(next, next === 0)
    set({ volume: next, muted: next === 0 })
  },

  toggleMute: () => {
    const muted = !get().muted
    applyVolume(get().volume, muted)
    set({ muted })
  },

  toggleShuffle: () => {
    const { shuffle, queue, queueIndex } = get()
    if (!shuffle) {
      if (queue.length > 0 && queueIndex >= 0) {
        unshuffled = queue
        set({ shuffle: true, queue: shuffledFrom(queue, queueIndex) })
      } else {
        set({ shuffle: true })
      }
      return
    }
    if (unshuffled) {
      const currentUid = queue[queueIndex]?.uid
      const restoredIndex = unshuffled.findIndex((item) => item.uid === currentUid)
      set({
        shuffle: false,
        queue: unshuffled,
        queueIndex: restoredIndex >= 0 ? restoredIndex : Math.max(0, queueIndex)
      })
      unshuffled = null
      return
    }
    set({ shuffle: false })
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one']
    const next = order[(order.indexOf(get().repeat) + 1) % order.length]
    set({ repeat: next })
  },

  addToQueue: (track, placement = 'end') => {
    useApp.getState().cacheTracks([track])
    const { queue, queueIndex } = get()
    const item: QueueItem = { uid: makeId('q'), trackId: track.id }
    if (queue.length === 0) {
      set({ queue: [item], queueIndex: 0 })
      void loadCurrent(true)
      return
    }
    if (placement === 'next') {
      const next = [...queue]
      next.splice(queueIndex + 1, 0, item)
      set({ queue: next })
      return
    }
    set({ queue: [...queue, item] })
  },

  removeFromQueue: (uid) => {
    const { queue, queueIndex } = get()
    const index = queue.findIndex((item) => item.uid === uid)
    if (index === -1) return
    const next = queue.filter((item) => item.uid !== uid)

    if (next.length === 0) {
      set({ queue: [], queueIndex: -1, currentId: null, playing: false, position: 0, duration: 0 })
      const element = el()
      element.removeAttribute('src')
      element.load()
      stopTicker()
      return
    }

    if (index < queueIndex) {
      set({ queue: next, queueIndex: queueIndex - 1 })
      return
    }
    if (index === queueIndex) {
      const target = Math.min(queueIndex, next.length - 1)
      set({ queue: next, queueIndex: target })
      if (get().playing) void loadCurrent(true)
      else usePlayer.setState({ currentId: next[target]?.trackId ?? null })
      return
    }
    set({ queue: next })
  },

  reorderQueue: (from, to) => {
    const { queue, queueIndex } = get()
    if (from < 0 || from >= queue.length) return
    const target = Math.max(0, Math.min(queue.length - 1, to))
    if (from === target) return
    const currentUid = queue[queueIndex]?.uid
    const next = [...queue]
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    const nextIndex = next.findIndex((item) => item.uid === currentUid)
    set({ queue: next, queueIndex: nextIndex >= 0 ? nextIndex : queueIndex })
    if (unshuffled) {
      const order = unshuffled
      const fromUid = queue[from]?.uid
      const toUid = queue[target]?.uid
      const a = order.findIndex((i) => i.uid === fromUid)
      const b = order.findIndex((i) => i.uid === toUid)
      if (a !== -1 && b !== -1) {
        const copy = [...order]
        const [m] = copy.splice(a, 1)
        copy.splice(b, 0, m)
        unshuffled = copy
      }
    }
  },

  clearQueue: () => {
    unshuffled = null
    get().stop()
    set({ queue: [], queueIndex: -1, currentId: null, duration: 0, error: null })
    const element = el()
    element.removeAttribute('src')
    element.load()
  },

  handleEnded: () => {
    const { repeat } = get()
    if (repeat === 'one') {
      get().seek(0)
      void el()
        .play()
        .catch(() => undefined)
      return
    }
    get().next()
  },

  dismissError: () => set({ error: null })
}))

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

// Switching profiles must silence the current track; the store cannot import
// this module (cycle), so it calls back into it instead.
registerPlaybackReset(() => {
  usePlayer.getState().clearQueue()
})

/** Subscribes to track changes so the app can react (history, lyrics, ...). */
export function onTrackChange(listener: (trackId: string | null) => void): () => void {
  return usePlayer.subscribe((state, previous) => {
    if (state.currentId !== previous.currentId) listener(state.currentId)
  })
}

/** Restores a persisted session (queue, volume, position). */
export function restoreSession(session: {
  trackId: string | null
  position: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  queue: QueueItem[]
  queueIndex: number
}): void {
  const element = el()
  applyVolume(session.volume, session.muted)
  usePlayer.setState({
    volume: session.volume,
    muted: session.muted,
    shuffle: session.shuffle,
    repeat: session.repeat,
    queue: session.queue,
    queueIndex: session.queueIndex,
    currentId: session.trackId,
    position: session.position ?? 0
  })

  if (session.queue.length === 0 || session.queueIndex < 0) return

  // Load the audio without autoplaying, then seek once metadata is available.
  void (async () => {
    const trackId = session.queue[session.queueIndex]?.trackId
    if (!trackId) return
    const track = await useApp.getState().ensureTrack(trackId)
    if (!track?.streamUrl) return
    element.src = track.streamUrl
    const restore = (): void => {
      try {
        element.currentTime = session.position ?? 0
      } catch {
        /* ignore */
      }
      element.removeEventListener('loadedmetadata', restore)
    }
    element.addEventListener('loadedmetadata', restore)
    element.load()
  })()
}

/** Snapshots the playback state for persistence. */
export function currentSession(): {
  trackId: string | null
  position: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  queue: QueueItem[]
  queueIndex: number
} {
  const state = usePlayer.getState()
  return {
    trackId: state.currentId,
    position: state.position,
    volume: state.volume,
    muted: state.muted,
    shuffle: state.shuffle,
    repeat: state.repeat,
    queue: state.queue,
    queueIndex: state.queueIndex
  }
}
