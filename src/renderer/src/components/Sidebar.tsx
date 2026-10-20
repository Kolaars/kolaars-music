/**
 * Left navigation rail.
 *
 * Holds the primary routes, the user's playlists (with inline rename/delete) and
 * the app-level entries at the bottom. Everything reads from the app store, so
 * counts and titles stay live as the library changes.
 */

import { useState, type JSX } from 'react'
import { useApp, type Route } from '../state/store'
import { Icon, type IconName } from './Icon'
import { MenuButton } from './MenuButton'
import { ConfirmModal, PromptModal } from './Dialogs'

interface NavEntry {
  route: Route
  label: string
  icon: IconName
}

const MAIN: NavEntry[] = [
  { route: { name: 'discover' }, label: 'Обзор', icon: 'compass' },
  { route: { name: 'search' }, label: 'Поиск', icon: 'search' },
  { route: { name: 'library' }, label: 'Библиотека', icon: 'library' },
  { route: { name: 'playlists' }, label: 'Плейлисты', icon: 'disc' },
  { route: { name: 'favorites' }, label: 'Избранное', icon: 'heart' },
  { route: { name: 'downloads' }, label: 'Загрузки', icon: 'download' },
  { route: { name: 'sources' }, label: 'Источники', icon: 'link' }
]

const FOOTER: NavEntry[] = [
  { route: { name: 'settings' }, label: 'Настройки', icon: 'settings' },
  { route: { name: 'shortcuts' }, label: 'Сокращения', icon: 'bolt' },
  { route: { name: 'about' }, label: 'О программе', icon: 'info' }
]

export interface SidebarProps {
  onNewPlaylist: () => void
}

export function Sidebar({ onNewPlaylist }: SidebarProps): JSX.Element {
  const route = useApp((state) => state.route)
  const setRoute = useApp((state) => state.setRoute)
  const playlists = useApp((state) => state.playlists)
  const userTracks = useApp((state) => state.userTracks)
  const favoriteCount = useApp((state) => state.favorites.size)
  const downloads = useApp((state) => state.downloads)
  const renamePlaylist = useApp((state) => state.renamePlaylist)
  const deletePlaylist = useApp((state) => state.deletePlaylist)

  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

  const activeDownloads = downloads.filter(
    (record) => record.status === 'downloading' || record.status === 'queued'
  ).length

  const countFor = (name: Route['name']): number | null => {
    if (name === 'library') return userTracks.length
    if (name === 'favorites') return favoriteCount
    if (name === 'downloads') return activeDownloads > 0 ? activeDownloads : null
    return null
  }

  const renderEntry = (entry: NavEntry): JSX.Element => {
    const active = route.name === entry.route.name
    const count = countFor(entry.route.name)
    return (
      <button
        key={entry.route.name}
        type="button"
        className={`navitem${active ? ' navitem--active' : ''}`}
        onClick={() => setRoute(entry.route)}
      >
        <span className="navitem__icon">
          <Icon name={entry.icon} size={17} />
        </span>
        <span className="navitem__label">{entry.label}</span>
        {count != null ? <span className="navitem__count">{count}</span> : null}
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">
          <Icon name="equalizer" size={20} />
        </span>
        <span className="sidebar__brandtext">
          <strong>Kolaars</strong>
          <small>Music</small>
        </span>
      </div>

      <nav className="sidebar__nav">{MAIN.map(renderEntry)}</nav>

      <div className="sidebar__section">
        <header className="sidebar__sectionhead">
          <span className="sidebar__sectiontitle">Мои плейлисты</span>
          <button
            type="button"
            className="iconbtn iconbtn--sm"
            title="Новый плейлист (Ctrl+N)"
            onClick={onNewPlaylist}
          >
            <Icon name="plus" size={16} />
          </button>
        </header>

        <div className="sidebar__scroll">
          {playlists.length === 0 ? (
            <p className="sidebar__hint">
              Пока пусто. Создайте плейлист, чтобы собрать любимые записи.
            </p>
          ) : (
            playlists.map((playlist) => {
              const active = route.name === 'playlist' && route.id === playlist.id
              return (
                <div
                  key={playlist.id}
                  className={`playlist-item${active ? ' playlist-item--active' : ''}`}
                >
                  <button
                    type="button"
                    className="playlist-item__main"
                    title={playlist.name}
                    onClick={() => setRoute({ name: 'playlist', id: playlist.id })}
                  >
                    <Icon name="disc" size={15} />
                    <span className="playlist-item__name">{playlist.name}</span>
                    <span className="playlist-item__count">{playlist.trackIds.length}</span>
                  </button>
                  <MenuButton
                    className="iconbtn iconbtn--sm playlist-item__menu"
                    icon="more"
                    title="Действия с плейлистом"
                    items={[
                      {
                        label: 'Переименовать',
                        icon: 'pencil',
                        onSelect: () => setRenaming({ id: playlist.id, name: playlist.name })
                      },
                      {
                        label: 'Удалить',
                        icon: 'trash',
                        danger: true,
                        separatorBefore: true,
                        onSelect: () => setRemoving({ id: playlist.id, name: playlist.name })
                      }
                    ]}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>

      <nav className="sidebar__foot">{FOOTER.map(renderEntry)}</nav>

      <PromptModal
        open={renaming !== null}
        title="Переименовать плейлист"
        label="Название"
        initialValue={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          if (renaming) void renamePlaylist(renaming.id, value)
          setRenaming(null)
        }}
      />

      <ConfirmModal
        open={removing !== null}
        title="Удалить плейлист?"
        text={
          <>
            Плейлист «{removing?.name}» будет удалён. Сами треки останутся в библиотеке.
          </>
        }
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void deletePlaylist(removing.id)
          setRemoving(null)
        }}
      />
    </aside>
  )
}
