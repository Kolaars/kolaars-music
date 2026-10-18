/**
 * Docked queue panel.
 *
 * Rows are reorderable with native drag & drop; the currently playing entry is
 * marked and stays highlighted as playback advances.
 */

import { useState, type JSX } from 'react'
import { formatTime } from '../lib/format'
import { useApp } from '../state/store'
import { usePlayer } from '../state/player'
import { Cover } from './Cover'
import { Icon } from './Icon'

export function QueuePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const queue = usePlayer((state) => state.queue)
  const queueIndex = usePlayer((state) => state.queueIndex)
  const catalogIndex = useApp((state) => state.catalogIndex)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  return (
    <aside className="queue" aria-label="Очередь воспроизведения">
      <header className="queue__head">
        <div className="queue__title">
          <Icon name="queue" size={16} />
          <h2>Очередь</h2>
          <span className="queue__count">{queue.length}</span>
        </div>
        <div className="queue__actions">
          <button
            type="button"
            className="iconbtn iconbtn--sm"
            title="Очистить очередь"
            disabled={queue.length === 0}
            onClick={() => usePlayer.getState().clearQueue()}
          >
            <Icon name="trash" size={16} />
          </button>
          <button type="button" className="iconbtn iconbtn--sm" title="Закрыть (Q)" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      {queue.length === 0 ? (
        <div className="queue__empty">
          <Icon name="queue" size={24} />
          <p>Очередь пуста</p>
          <span>Включите трек из каталога или добавьте его в очередь.</span>
        </div>
      ) : (
        <div className="queue__list" onDragLeave={() => setOverIndex(null)}>
          {queue.map((item, index) => {
            const track = catalogIndex.get(item.trackId)
            const current = index === queueIndex
            const upcoming = index === queueIndex + 1
            return (
              <div
                key={item.uid}
                className={`queue__row${current ? ' queue__row--current' : ''}${
                  overIndex === index && dragIndex !== null && dragIndex !== index ? ' queue__row--over' : ''
                }`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOverIndex(index)
                }}
                onDrop={() => {
                  if (dragIndex !== null) usePlayer.getState().reorderQueue(dragIndex, index)
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onDoubleClick={() => usePlayer.getState().playAt(index)}
              >
                <span className="queue__grip" title="Перетащите, чтобы изменить порядок">
                  <Icon name="grip" size={14} />
                </span>

                <button
                  type="button"
                  className="queue__play"
                  title="Воспроизвести"
                  onClick={() => usePlayer.getState().playAt(index)}
                >
                  {current ? (
                    <Icon name="equalizer" size={14} />
                  ) : (
                    <span className="queue__number">{index + 1}</span>
                  )}
                </button>

                <Cover
                  src={track?.artwork}
                  alt={track?.title ?? 'Трек'}
                  rounded="sm"
                  className="queue__cover"
                />

                <div className="queue__meta">
                  <span className="queue__name">{track?.title ?? 'Недоступный трек'}</span>
                  <span className="queue__artist">
                    {track?.artist ?? '—'}
                    {upcoming ? ' · следующий' : ''}
                  </span>
                </div>

                <span className="queue__time">{formatTime(track?.duration)}</span>

                <button
                  type="button"
                  className="iconbtn iconbtn--sm queue__remove"
                  title="Убрать из очереди"
                  onClick={() => usePlayer.getState().removeFromQueue(item.uid)}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <footer className="queue__foot">
        <span>{queue.length > 0 && queueIndex >= 0 ? `Играет ${queueIndex + 1} из ${queue.length}` : '—'}</span>
        {queue.length > 0 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            title="Перемешать очередь дальше текущего трека"
            onClick={() => usePlayer.getState().toggleShuffle()}
          >
            <Icon name="shuffle" size={15} />
            Перемешать
          </button>
        ) : null}
      </footer>
    </aside>
  )
}
