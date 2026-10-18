/**
 * Lyrics state for the currently selected track.
 *
 * Resolution order is: what the user saved → the bundled public-domain pack →
 * nothing. Online providers are only consulted when the user asks for them,
 * which keeps the app usable offline and avoids surprising network traffic.
 */

import { create } from 'zustand'
import type { LyricLine, Lyrics, LyricsCandidate } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import type { BundledSong, WikisourceHit } from '../../../preload/index'
import { useApp } from './store'

interface LyricsState {
  trackId: string | null
  saved: Lyrics | null
  bundled: Lyrics | null
  candidates: LyricsCandidate[]
  wikisource: WikisourceHit[]
  bundledMatches: BundledSong[]
  loading: boolean
  searching: boolean
  lastQuery: string

  load: (track: { id: string; title: string; artist: string }) => Promise<void>
  reset: () => void
  searchOnline: (track: { id: string; title: string; artist: string; duration?: number | null }) => Promise<void>
  searchSources: (query: string) => Promise<void>
  adopt: (candidate: LyricsCandidate) => Promise<void>
  applyBundled: (songId: string) => Promise<void>
  applyWikisource: (title: string) => Promise<void>
  save: (lyrics: Lyrics) => Promise<void>
  remove: (trackId: string) => Promise<void>
  importFromFile: (track: { id: string; title: string; artist: string }) => Promise<void>
  exportToFile: (track: { id: string; title: string; artist: string; album?: string | null }) => Promise<void>
  draftTimings: (plain: string, duration: number) => Promise<LyricLine[]>
}

export const useLyrics = create<LyricsState>((set, get) => ({
  trackId: null,
  saved: null,
  bundled: null,
  candidates: [],
  wikisource: [],
  bundledMatches: [],
  loading: false,
  searching: false,
  lastQuery: '',

  load: async (track) => {
    set({ trackId: track.id, loading: true, candidates: [], wikisource: [], bundledMatches: [] })
    try {
      const result = await api.lyrics.get({
        id: track.id,
        title: track.title,
        artist: track.artist
      })
      // Guard against a slower response for a track the user already left.
      if (get().trackId !== track.id) return
      set({ saved: result.saved, bundled: result.bundled, loading: false })
    } catch (error) {
      set({ loading: false })
      useApp.getState().toast(`Не удалось загрузить текст: ${errorMessage(error)}`, 'error')
    }
  },

  reset: () =>
    set({
      trackId: null,
      saved: null,
      bundled: null,
      candidates: [],
      wikisource: [],
      bundledMatches: [],
      loading: false
    }),

  searchOnline: async (track) => {
    set({ searching: true })
    try {
      const candidates = await api.lyrics.search({
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration ?? null
      } as never)
      if (get().trackId !== track.id) return
      set({ candidates, searching: false })
      if (candidates.length === 0) {
        useApp.getState().toast('В открытой базе LRCLIB ничего не найдено', 'info')
      }
    } catch (error) {
      set({ searching: false })
      useApp.getState().toast(`Ошибка поиска текста: ${errorMessage(error)}`, 'error')
    }
  },

  searchSources: async (query) => {
    set({ searching: true, lastQuery: query })
    try {
      // The bundled pack lives in the app, so show those hits immediately
      // instead of hiding them behind the Wikisource round trip.
      const local = await api.lyrics.bundledSearch(query).catch(() => [])
      if (get().lastQuery !== query) return
      set({ bundledMatches: local })

      const result = await api.lyrics.sources(query)
      if (get().lastQuery !== query) return
      set({
        bundledMatches: result.bundled.length > 0 ? result.bundled : local,
        wikisource: result.wikisource,
        searching: false
      })
    } catch (error) {
      if (get().lastQuery !== query) return
      set({ searching: false })
      useApp.getState().toast(`Ошибка поиска источников: ${errorMessage(error)}`, 'error')
    }
  },

  adopt: async (candidate) => {
    const trackId = get().trackId
    if (!trackId) return
    const lyrics: Lyrics = { ...candidate, trackId, origin: candidate.origin ?? 'user' }
    await get().save(lyrics)
    useApp.getState().toast(`Текст сохранён (${candidate.provider ?? 'источник'})`, 'success')
    set({ candidates: [] })
  },

  applyBundled: async (songId) => {
    const trackId = get().trackId
    if (!trackId) return
    const lyrics = await api.lyrics.bundledGet(songId, trackId)
    if (!lyrics) return
    await get().save(lyrics)
    useApp.getState().toast('Текст взят из открытого пака', 'success')
    set({ bundledMatches: [] })
  },

  applyWikisource: async (title) => {
    const trackId = get().trackId
    if (!trackId) return
    const lyrics = await api.lyrics.wikisourceFetch(title, trackId)
    if (!lyrics) {
      useApp.getState().toast('Не удалось получить текст из Wikisource', 'error')
      return
    }
    await get().save(lyrics)
    useApp.getState().toast('Текст получен из Wikisource', 'success')
    set({ wikisource: [] })
  },

  save: async (lyrics) => {
    try {
      const saved = await api.lyrics.save(lyrics)
      set({ saved })
      const app = useApp.getState()
      // Kept in sync so track rows can show their "has lyrics" badge instantly.
      useApp.setState({ lyricsIds: new Set([...app.lyricsIds, saved.trackId]) })
    } catch (error) {
      useApp.getState().toast(`Не удалось сохранить текст: ${errorMessage(error)}`, 'error')
    }
  },

  remove: async (trackId) => {
    await api.lyrics.remove(trackId)
    set({ saved: null })
    const app = useApp.getState()
    const next = new Set(app.lyricsIds)
    next.delete(trackId)
    useApp.setState({ lyricsIds: next })
    useApp.getState().toast('Пользовательский текст удалён')
  },

  importFromFile: async (track) => {
    try {
      const lyrics = await api.lyrics.importLrc({
        id: track.id,
        title: track.title,
        artist: track.artist
      } as never)
      if (!lyrics) return
      set({ saved: lyrics })
      const app = useApp.getState()
      useApp.setState({ lyricsIds: new Set([...app.lyricsIds, lyrics.trackId]) })
      useApp
        .getState()
        .toast(lyrics.synced?.length ? 'Импортирован синхронный текст' : 'Импортирован текст', 'success')
    } catch (error) {
      useApp.getState().toast(`Ошибка импорта: ${errorMessage(error)}`, 'error')
    }
  },

  exportToFile: async (track) => {
    const lyrics = get().saved ?? get().bundled
    if (!lyrics) {
      useApp.getState().toast('Нет текста для сохранения', 'error')
      return
    }
    try {
      const path = await api.lyrics.exportLrc(
        { id: track.id, title: track.title, artist: track.artist, album: track.album } as never,
        lyrics
      )
      if (path) useApp.getState().toast('Файл сохранён', 'success')
    } catch (error) {
      useApp.getState().toast(`Ошибка сохранения: ${errorMessage(error)}`, 'error')
    }
  },

  draftTimings: async (plain, duration) => api.lyrics.draftTimings(plain, duration)
}))

/** The lyrics that should currently be displayed. */
export function activeLyrics(state: LyricsState): Lyrics | null {
  return state.saved ?? state.bundled
}

/** Index of the line that should be highlighted at `position` seconds. */
export function lineIndexAt(lines: LyricLine[] | null | undefined, position: number): number {
  if (!lines || lines.length === 0) return -1
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= position + 0.15) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
