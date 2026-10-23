/**
 * Application shell.
 *
 * Owns everything that is not a view: bootstrap, theme, routing, the docked
 * panels, playback side effects (history, notifications, session persistence)
 * and the bridge to the native application menu.
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { MediaCommand } from '@shared/ipc'
import { api } from './lib/api'
import { useApp, type Route } from './state/store'
import { currentSession, onTrackChange, restoreSession, usePlayer } from './state/player'
import { useLyrics } from './state/lyrics'
import { useTheme } from './hooks/useTheme'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMediaSession } from './hooks/useMediaSession'
import { useDiscordRpc } from './hooks/useDiscordRpc'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { NowPlaying } from './components/NowPlaying'
import { ImportListDialog } from './components/ImportListDialog'
import { ExternalPlayer } from './components/ExternalPlayer'
import { Toasts } from './components/Toasts'
import { LyricsPanel } from './components/LyricsPanel'
import { PromptModal } from './components/Dialogs'
import { EmptyState } from './components/Feedback'
import { DiscoverView } from './views/DiscoverView'
import { SearchView } from './views/SearchView'
import { LibraryView } from './views/LibraryView'
import { PlaylistsView } from './views/PlaylistsView'
import { PlaylistView } from './views/PlaylistView'
import { FavoritesView } from './views/FavoritesView'
import { DownloadsView } from './views/DownloadsView'
import { SourcesView } from './views/SourcesView'
import { AlbumView } from './views/AlbumView'
import { SettingsView } from './views/SettingsView'
import { AboutView } from './views/AboutView'
import { ShortcutsView } from './views/ShortcutsView'

const ROUTE_TITLE: Record<Route['name'], string> = {
  discover: 'Обзор',
  search: 'Поиск',
  library: 'Библиотека',
  playlists: 'Плейлисты',
  playlist: 'Плейлист',
  favorites: 'Избранное',
  downloads: 'Загрузки',
  sources: 'Источники',
  album: 'Альбом',
  settings: 'Настройки',
  shortcuts: 'Сокращения',
  about: 'О программе'
}

function routeFromName(name: string): Route | null {
  switch (name) {
    case 'discover':
    case 'search':
    case 'library':
    case 'playlists':
    case 'favorites':
    case 'downloads':
    case 'sources':
    case 'settings':
    case 'shortcuts':
    case 'about':
      return { name }
    default:
      return null
  }
}

export default function App(): JSX.Element {
  const ready = useApp((state) => state.ready)
  const route = useApp((state) => state.route)
  const routeStack = useApp((state) => state.routeStack)
  const settings = useApp((state) => state.settings)
  const bootstrap = useApp((state) => state.bootstrap)
  const setRoute = useApp((state) => state.setRoute)
  const goBack = useApp((state) => state.goBack)
  const nowPlayingOpen = useApp((state) => state.nowPlayingOpen)
  const queueOpen = useApp((state) => state.queueOpen)
  const setNowPlayingOpen = useApp((state) => state.setNowPlayingOpen)
  const setQueueOpen = useApp((state) => state.setQueueOpen)

  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false)

  const currentId = usePlayer((state) => state.currentId)
  const currentTrack = useApp((state) => (currentId ? state.catalogIndex.get(currentId) : undefined))
  const playlists = useApp((state) => state.playlists)

  useTheme(settings.theme, settings.accent)
  useMediaSession(currentTrack ?? null)
  useDiscordRpc(ready)

  /* ---------------------------- bootstrap ------------------------- */

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  /* ------------------------- session restore ----------------------- */

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await api.store.load()
        if (cancelled || !snapshot.settings.resumeSession) return
        if (snapshot.session.queue.length === 0 && !snapshot.session.trackId) return
        // Restoring is a background task: the window is already interactive
        // while the snapshot is being read. If the user (or a test) started a
        // track in the meantime, their choice wins — otherwise a slow restore
        // would yank playback back to yesterday's queue.
        const player = usePlayer.getState()
        if (player.currentId || player.queue.length > 0) return
        restoreSession(snapshot.session)
      } catch {
        /* a fresh install has nothing to restore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready])

  /* ----------------------- session persistence --------------------- */

  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => {
      if (!useApp.getState().settings.resumeSession) return
      void api.store.saveSession(currentSession())
    }, 5000)

    const onUnload = (): void => {
      if (!useApp.getState().settings.resumeSession) return
      void api.store.saveSession(currentSession())
    }
    window.addEventListener('beforeunload', onUnload)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [ready])

  /* ------------------- track change side effects -------------------- */

  useEffect(() => {
    const off = onTrackChange((trackId) => {
      const store = useApp.getState()
      if (!trackId) {
        useLyrics.getState().reset()
        return
      }
      const track = store.catalogIndex.get(trackId)
      store.addHistory(trackId)
      if (!track) return

      void useLyrics.getState().load({ id: track.id, title: track.title, artist: track.artist })

      if (store.settings.notifications && typeof Notification !== 'undefined') {
        try {
          new Notification(track.title, {
            body: track.artist,
            ...(track.artwork ? { icon: track.artwork } : {}),
            silent: true
          })
        } catch {
          /* notifications unavailable */
        }
      }
    })
    return off
  }, [])

  /* ------------------------ player errors -------------------------- */

  useEffect(() => {
    const off = usePlayer.subscribe((state, previous) => {
      if (state.error && state.error !== previous.error) {
        useApp.getState().toast(state.error, 'error')
        usePlayer.getState().dismissError()
      }
    })
    return off
  }, [])

  /* --------------------------- connectivity ------------------------ */

  useEffect(() => {
    const offline = (): void =>
      useApp.getState().toast('Нет подключения — доступен офлайн-каталог и загруженные треки', 'info')
    const online = (): void => useApp.getState().toast('Подключение восстановлено', 'success')
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [])

  /* -------------------------- native menu -------------------------- */

  const openNewPlaylist = useCallback(() => setNewPlaylistOpen(true), [])

  const toggleLyricsPanel = useCallback(() => {
    const next = !lyricsOpen
    setLyricsOpen(next)
    if (next) setQueueOpen(false)
  }, [lyricsOpen, setQueueOpen])

  const toggleQueuePanel = useCallback(() => {
    const next = !queueOpen
    setQueueOpen(next)
    if (next) setLyricsOpen(false)
  }, [queueOpen, setQueueOpen])

  /** Now Playing is a full-screen overlay: the side docks would only compete. */
  const openNowPlaying = useCallback(() => {
    setLyricsOpen(false)
    setQueueOpen(false)
    setNowPlayingOpen(true)
  }, [setQueueOpen, setNowPlayingOpen])

  useEffect(() => {
    const offCommand = api.app.onMediaCommand((command: MediaCommand) => {
      const player = usePlayer.getState()
      switch (command) {
        case 'play-pause':
          player.toggle()
          break
        case 'next':
          player.next()
          break
        case 'previous':
          player.previous()
          break
        case 'stop':
          player.stop()
          break
        case 'volume-up':
          player.adjustVolume(0.05)
          break
        case 'volume-down':
          player.adjustVolume(-0.05)
          break
        case 'mute':
          player.toggleMute()
          break
        case 'shuffle':
          player.toggleShuffle()
          break
        case 'repeat':
          player.cycleRepeat()
          break
        case 'toggle-lyrics':
          toggleLyricsPanel()
          break
        case 'toggle-queue':
          toggleQueuePanel()
          break
        case 'focus-search':
          setRoute({ name: 'search' })
          window.setTimeout(() => {
            document.getElementById('global-search')?.focus()
          }, 60)
          break
        case 'import-files':
          void useApp.getState().importFiles()
          break
        case 'import-folder':
          void useApp.getState().importFolder()
          break
        case 'import-list':
          useApp.getState().setImportListOpen(true)
          break
        case 'new-playlist':
          setNewPlaylistOpen(true)
          break
        case 'find-lyrics':
          setLyricsOpen(true)
          setQueueOpen(false)
          useApp.getState().requestLyricsTab('sources')
          break
        default:
          break
      }
    })

    const offNavigate = api.app.onNavigate((name) => {
      const next = routeFromName(name)
      if (next) setRoute(next)
    })

    return () => {
      offCommand()
      offNavigate()
    }
  }, [setRoute, setQueueOpen, toggleLyricsPanel, toggleQueuePanel])

  /* --------------------------- shortcuts --------------------------- */

  const shortcutHandlers = useMemo(
    () => ({
      onToggleLyrics: toggleLyricsPanel,
      onToggleQueue: toggleQueuePanel,
      onFocusSearch: () => {
        setRoute({ name: 'search' })
        window.setTimeout(() => document.getElementById('global-search')?.focus(), 60)
      },
      onToggleFavorite: () => {
        const id = usePlayer.getState().currentId
        if (id) void useApp.getState().toggleFavorite(id)
      },
      onEscape: () => {
        if (useApp.getState().nowPlayingOpen) setNowPlayingOpen(false)
      }
    }),
    [toggleLyricsPanel, toggleQueuePanel, setRoute, setNowPlayingOpen]
  )

  useKeyboardShortcuts(shortcutHandlers)

  /* ---------------------------- rendering -------------------------- */

  const view = (() => {
    switch (route.name) {
      case 'discover':
        return <DiscoverView />
      case 'search':
        return <SearchView />
      case 'library':
        return <LibraryView />
      case 'playlists':
        return <PlaylistsView onNewPlaylist={openNewPlaylist} />
      case 'playlist':
        return <PlaylistView id={route.id} />
      case 'favorites':
        return <FavoritesView />
      case 'downloads':
        return <DownloadsView />
      case 'sources':
        return <SourcesView />
      case 'album':
        return <AlbumView identifier={route.identifier} title={route.title} />
      case 'settings':
        return <SettingsView />
      case 'shortcuts':
        return <ShortcutsView />
      case 'about':
        return <AboutView />
      default:
        return null
    }
  })()

  const subtitle =
    route.name === 'playlist'
      ? playlists.find((playlist) => playlist.id === route.id)?.name
      : route.name === 'album'
        ? route.title
        : undefined

  return (
    <div className="app-shell">
      <TitleBar
        title={ROUTE_TITLE[route.name] ?? 'Kolaars Music'}
        subtitle={subtitle}
        canGoBack={routeStack.length > 0}
        onBack={goBack}
      />

      <div className="app-body">
        <Sidebar onNewPlaylist={openNewPlaylist} />

        <main className="app-main">
          {ready ? view : <EmptyState icon="equalizer" title="Запуск Kolaars Music…" text="Читаем каталог и библиотеку." />}
        </main>

        {queueOpen ? <QueuePanel onClose={() => setQueueOpen(false)} /> : null}

        {lyricsOpen && !queueOpen ? (
          <aside className="lyricsdock">
            <button
              type="button"
              className="iconbtn iconbtn--sm lyricsdock__close"
              title="Закрыть панель текста (L)"
              onClick={() => setLyricsOpen(false)}
            >
              ×
            </button>
            <LyricsPanel track={currentTrack ?? null} variant="panel" />
          </aside>
        ) : null}
      </div>

      <PlayerBar
        lyricsOpen={lyricsOpen}
        queueOpen={queueOpen}
        onToggleLyrics={toggleLyricsPanel}
        onToggleQueue={toggleQueuePanel}
        onOpenNowPlaying={openNowPlaying}
      />

      <ExternalPlayer />

      {nowPlayingOpen ? <NowPlaying /> : null}

      <ImportListDialog />

      <Toasts />

      <PromptModal
        open={newPlaylistOpen}
        title="Новый плейлист"
        label="Название"
        placeholder="Например: Вечерний джаз"
        confirmLabel="Создать"
        onCancel={() => setNewPlaylistOpen(false)}
        onConfirm={(name) => {
          setNewPlaylistOpen(false)
          void useApp.getState().createPlaylist(name)
        }}
      />
    </div>
  )
}
