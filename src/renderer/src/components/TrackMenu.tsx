/**
 * The "…" menu attached to every track.
 *
 * It is the single place that knows how to play, queue, favourite, download,
 * attribute, reveal and remove a track — so every list in the app gets the same
 * behaviour for free.
 */

import { useMemo, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { api } from '../lib/api'
import { useApp, useIsFavorite } from '../state/store'
import { usePlayer } from '../state/player'
import { MenuButton, type MenuItemSpec } from './MenuButton'
import { Modal } from './Modal'
import { Icon, type IconName } from './Icon'

export interface TrackMenuProps {
  track: Track
  className?: string
  icon?: IconName
  title?: string
  /** Track list this row belongs to, so "play" keeps the surrounding order. */
  context?: Track[]
  contextIndex?: number
}

export function TrackMenu({
  track,
  className,
  icon = 'more',
  title = 'Действия с треком',
  context,
  contextIndex
}: TrackMenuProps): JSX.Element {
  const favorite = useIsFavorite(track.id)
  const playlists = useApp((state) => state.playlists)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const items = useMemo<MenuItemSpec[]>(() => {
    const list: MenuItemSpec[] = []

    list.push({
      label: 'Воспроизвести',
      icon: 'play',
      onSelect: () => {
        const player = usePlayer.getState()
        if (context && context.length > 0) player.playTracks(context, contextIndex ?? 0)
        else player.playTrack(track)
      }
    })
    list.push({
      label: 'Играть следующим',
      icon: 'next',
      onSelect: () => usePlayer.getState().addToQueue(track, 'next')
    })
    list.push({
      label: 'В очередь',
      icon: 'queue',
      onSelect: () => usePlayer.getState().addToQueue(track, 'end')
    })

    list.push({
      label: favorite ? 'Убрать из избранного' : 'В избранное',
      icon: favorite ? 'heart-filled' : 'heart',
      separatorBefore: true,
      onSelect: () => void useApp.getState().toggleFavorite(track.id)
    })

    list.push({
      label: 'Добавить в плейлист…',
      icon: 'plus',
      onSelect: () => setPlaylistOpen(true)
    })

    // An external track's identifier is a provider id, not an archive
    // identifier: it has no album page in this app, and no file to download.
    const external = Boolean(track.external) || track.source === 'external'

    if (track.identifier && !external) {
      list.push({
        label: 'Перейти к альбому',
        icon: 'disc',
        onSelect: () =>
          useApp.getState().setRoute({
            name: 'album',
            identifier: track.identifier as string,
            title: track.album ?? undefined
          })
      })
    }

    if (!external) {
      const canDownload = !track.offline && (Boolean(track.streamUrl) || Boolean(track.identifier))
      list.push({
        label: track.offline ? 'Уже доступно офлайн' : 'Скачать офлайн',
        icon: 'download',
        disabled: !canDownload,
        separatorBefore: true,
        onSelect: () => void useApp.getState().startDownload(track)
      })
    }

    if (track.sourceUrl) {
      list.push({
        label: 'Открыть страницу записи',
        icon: 'external',
        onSelect: () => void api.app.openExternal(track.sourceUrl as string)
      })
    }

    if (track.filePath) {
      list.push({
        label: 'Показать в папке',
        icon: 'folder',
        onSelect: () => void api.local.reveal(track.filePath as string)
      })
    }

    if (track.source !== 'seed' || track.offline) {
      list.push({
        label: 'Удалить из библиотеки',
        icon: 'trash',
        danger: true,
        separatorBefore: true,
        onSelect: () => void useApp.getState().removeTrack(track.id)
      })
    }

    return list
  }, [track, favorite, context, contextIndex])

  const addTo = async (playlistId: string): Promise<void> => {
    await useApp.getState().addTracksToPlaylist(playlistId, [track])
    useApp.getState().toast('Трек добавлен в плейлист', 'success')
    setPlaylistOpen(false)
  }

  const createAndAdd = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    const playlist = await useApp.getState().createPlaylist(name, [track])
    if (playlist) useApp.getState().toast(`Плейлист «${playlist.name}» создан`, 'success')
    setNewName('')
    setPlaylistOpen(false)
  }

  return (
    <>
      <MenuButton items={items} className={className ?? 'iconbtn iconbtn--sm'} icon={icon} title={title} />

      <Modal
        open={playlistOpen}
        title="Добавить в плейлист"
        subtitle={`${track.artist} — ${track.title}`}
        onClose={() => setPlaylistOpen(false)}
        width={480}
      >
        {playlists.length === 0 ? (
          <p className="dialog__text">Плейлистов пока нет — создайте первый ниже.</p>
        ) : (
          <ul className="source-list">
            {playlists.map((playlist) => (
              <li key={playlist.id} className="source-list__row">
                <div className="source-list__text">
                  <span className="source-list__title">
                    <Icon name="disc" size={14} /> {playlist.name}
                  </span>
                  <span className="source-list__meta">{playlist.trackIds.length} треков</span>
                </div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void addTo(playlist.id)}>
                  Добавить
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog__form">
          <label className="field__label" htmlFor="new-playlist-name">
            Новый плейлист
          </label>
          <div className="dialog__row">
            <input
              id="new-playlist-name"
              className="input"
              spellCheck={false}
              placeholder="Название плейлиста"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createAndAdd()
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={!newName.trim()}
              onClick={() => void createAndAdd()}
            >
              <Icon name="plus" size={16} />
              Создать
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
