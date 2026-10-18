/** One playlist: its tracks, with reorder-free editing and an "add tracks" picker. */

import { useMemo, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { useApp } from '../state/store'
import { playAll, shuffleAll } from '../lib/play'
import { trackCountLabel } from '../lib/format'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { TrackList } from '../components/TrackList'
import { EmptyState } from '../components/Feedback'
import { ConfirmModal, PromptModal } from '../components/Dialogs'
import { Modal } from '../components/Modal'

export function PlaylistView({ id }: { id: string }): JSX.Element {
  const playlists = useApp((state) => state.playlists)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const catalog = useApp((state) => state.catalog)
  const removeTrackFromPlaylist = useApp((state) => state.removeTrackFromPlaylist)
  const renamePlaylist = useApp((state) => state.renamePlaylist)
  const deletePlaylist = useApp((state) => state.deletePlaylist)
  const addTracksToPlaylist = useApp((state) => state.addTracksToPlaylist)
  const setRoute = useApp((state) => state.setRoute)

  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addFilter, setAddFilter] = useState('')

  const playlist = playlists.find((entry) => entry.id === id)

  const tracks: Track[] = useMemo(() => {
    if (!playlist) return []
    return playlist.trackIds
      .map((trackId) => catalogIndex.get(trackId))
      .filter((track): track is Track => Boolean(track))
  }, [playlist, catalogIndex])

  const candidates = useMemo(() => {
    const needle = addFilter.trim().toLowerCase()
    const existing = new Set(playlist?.trackIds ?? [])
    return catalog
      .filter((track) => !existing.has(track.id))
      .filter((track) =>
        needle ? `${track.title} ${track.artist}`.toLowerCase().includes(needle) : true
      )
      .slice(0, 60)
  }, [catalog, addFilter, playlist])

  if (!playlist) {
    return (
      <Page>
        <EmptyState
          icon="disc"
          title="Плейлист не найден"
          text="Возможно, он был удалён."
          action={{ label: 'К плейлистам', icon: 'chevron-left', onClick: () => setRoute({ name: 'playlists' }) }}
        />
      </Page>
    )
  }

  return (
    <Page className="page--playlist">
      <PageHeader
        icon="disc"
        title={playlist.name}
        subtitle={trackCountLabel(tracks.length)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={tracks.length === 0}
              onClick={() => playAll(tracks)}
            >
              <Icon name="play" size={15} />
              Играть
            </button>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              title="Перемешать"
              disabled={tracks.length === 0}
              onClick={() => shuffleAll(tracks)}
            >
              <Icon name="shuffle" size={16} />
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setAddFilter('')
                setAdding(true)
              }}
            >
              <Icon name="plus" size={15} />
              Добавить треки
            </button>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              title="Переименовать"
              onClick={() => setRenaming(true)}
            >
              <Icon name="pencil" size={16} />
            </button>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              title="Удалить плейлист"
              onClick={() => setRemoving(true)}
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        }
      />

      {tracks.length === 0 ? (
        <EmptyState
          icon="disc"
          title="Плейлист пуст"
          text="Добавьте треки из каталога или из своей библиотеки."
          action={{
            label: 'Добавить треки',
            icon: 'plus',
            onClick: () => {
              setAddFilter('')
              setAdding(true)
            }
          }}
        />
      ) : (
        <TrackList
          tracks={tracks}
          onRemove={(track) => void removeTrackFromPlaylist(playlist.id, track.id)}
          removeTitle="Убрать из плейлиста"
        />
      )}

      <PromptModal
        open={renaming}
        title="Переименовать плейлист"
        label="Название"
        initialValue={playlist.name}
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => {
          void renamePlaylist(playlist.id, value)
          setRenaming(false)
        }}
      />

      <ConfirmModal
        open={removing}
        title="Удалить плейлист?"
        text={<>Плейлист «{playlist.name}» будет удалён. Треки останутся в каталоге.</>}
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          void deletePlaylist(playlist.id)
          setRemoving(false)
        }}
      />

      <Modal
        open={adding}
        title="Добавить треки"
        subtitle={`В плейлист «${playlist.name}»`}
        onClose={() => setAdding(false)}
        width={640}
      >
        <div className="searchbar searchbar--inline">
          <Icon name="search" size={16} />
          <input
            className="input"
            autoFocus
            value={addFilter}
            spellCheck={false}
            placeholder="Поиск по каталогу"
            onChange={(event) => setAddFilter(event.target.value)}
          />
        </div>

        {candidates.length === 0 ? (
          <p className="dialog__text">Ничего не найдено.</p>
        ) : (
          <ul className="source-list source-list--scroll">
            {candidates.map((track) => (
              <li key={track.id} className="source-list__row">
                <div className="source-list__text">
                  <span className="source-list__title">{track.title}</span>
                  <span className="source-list__meta">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void addTracksToPlaylist(playlist.id, [track])}
                >
                  <Icon name="plus" size={15} />
                  Добавить
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Page>
  )
}
