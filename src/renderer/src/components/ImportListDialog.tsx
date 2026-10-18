/**
 * "Импорт списка треков" — how a playlist from another service gets in.
 *
 * The user pastes a list (or opens a `.txt`/`.csv`/`.m3u` file); the entries are
 * parsed here so the count and a preview can be shown before anything happens.
 * Resolving them (library → open archive → name only) and fetching lyrics takes
 * place in the main process and streams progress back.
 *
 * Audio is only ever taken from sources that allow it: the user's own local
 * files, offline downloads, and the open archive. For copyrighted music there is
 * nothing legitimate to point at, so such an entry is kept as a name with its
 * lyrics and no audio — never as a stream ripped from a closed service.
 */

import { useMemo, useState, type JSX } from 'react'
import { parseTrackList } from '@shared/tracklist'
import { api, errorMessage } from '../lib/api'
import { useApp, type TrackListImportResult } from '../state/store'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { Switch } from './Controls'

const PREVIEW = 6

function fileStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.[^.]+$/, '')
}

export function ImportListDialog(): JSX.Element | null {
  const open = useApp((state) => state.importListOpen)
  const setImportListOpen = useApp((state) => state.setImportListOpen)
  const runTrackListImport = useApp((state) => state.runTrackListImport)
  const setRoute = useApp((state) => state.setRoute)
  const toast = useApp((state) => state.toast)
  const progress = useApp((state) => state.importProgress)

  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [searchArchive, setSearchArchive] = useState(false)
  const [fetchLyrics, setFetchLyrics] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TrackListImportResult | null>(null)

  const entries = useMemo(() => parseTrackList(text), [text])

  const close = (): void => {
    setImportListOpen(false)
    setText('')
    setName('')
    setResult(null)
    setRunning(false)
  }

  const pickFile = async (): Promise<void> => {
    try {
      const file = await api.tracklist.pickFile()
      if (!file) return
      setText(file.text)
      if (!name.trim()) setName(fileStem(file.path))
    } catch (error) {
      toast(`Не удалось открыть файл: ${errorMessage(error)}`, 'error')
    }
  }

  const run = async (): Promise<void> => {
    setRunning(true)
    const outcome = await runTrackListImport({ text, name, searchArchive, fetchLyrics })
    setRunning(false)
    if (outcome) setResult(outcome)
  }

  if (!open) return null

  /* ------------------------------- done ---------------------------- */
  if (result) {
    const { outcome, playlist } = result
    return (
      <Modal
        open
        title="Импорт завершён"
        subtitle={`${outcome.stats.total} строк обработано за ${(outcome.durationMs / 1000).toFixed(1)} с`}
        onClose={close}
        width={640}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={close}>
              Закрыть
            </button>
            {playlist ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setRoute({ name: 'playlist', id: playlist.id })
                  close()
                }}
              >
                <Icon name="disc" size={16} />
                Открыть плейлист
              </button>
            ) : null}
          </>
        }
      >
        <ul className="importresult">
          <li className="importresult__row">
            <Icon name="folder" size={16} />
            <span className="importresult__label">Найдено в библиотеке</span>
            <span className="importresult__value">{outcome.stats.local}</span>
          </li>
          <li className="importresult__row">
            <Icon name="globe" size={16} />
            <span className="importresult__label">Найдено в открытом архиве</span>
            <span className="importresult__value">{outcome.stats.archive}</span>
          </li>
          <li className="importresult__row">
            <Icon name="lyrics" size={16} />
            <span className="importresult__label">Тексты сохранены</span>
            <span className="importresult__value">{outcome.stats.lyrics}</span>
          </li>
          <li className="importresult__row importresult__row--muted">
            <Icon name="info" size={16} />
            <span className="importresult__label">Без звука — только название и текст</span>
            <span className="importresult__value">{outcome.stats.metadata}</span>
          </li>
        </ul>

        {outcome.stats.metadata > 0 ? (
          <p className="page__note">
            Для этих строк свободного источника звука нет: современная музыка защищена авторским
            правом, и приложение не качает её из закрытых сервисов. Названия и тексты сохранены —
            воспроизвести их можно, добавив свои файлы в библиотеку.
          </p>
        ) : null}

        {playlist ? (
          <p className="dialog__text">
            Создан плейлист «{playlist.name}» — {playlist.trackIds.length} треков.
          </p>
        ) : null}
      </Modal>
    )
  }

  /* ------------------------------ running -------------------------- */
  if (running) {
    const done = progress?.done ?? 0
    const total = progress?.total ?? entries.length
    return (
      <Modal open title="Импорт списка треков" onClose={() => {}} width={640}>
        <p className="dialog__text">
          Обработано {done} из {total}
          {progress?.current ? `: ${progress.current}` : '…'}
        </p>
        <div className="progress-line">
          <div className="progress-line__fill" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
        <p className="page__note">
          Если включён поиск в открытом архиве, каждый трек требует отдельного запроса — это может
          занять несколько минут.
        </p>
      </Modal>
    )
  }

  /* ------------------------------- input --------------------------- */
  return (
    <Modal
      open
      title="Импорт списка треков"
      subtitle="Вставьте список из другого сервиса или откройте файл"
      onClose={close}
      width={760}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={close}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={entries.length === 0}
            onClick={() => void run()}
          >
            <Icon name="upload" size={16} />
            Импортировать{entries.length ? ` (${entries.length})` : ''}
          </button>
        </>
      }
    >
      <div className="dialog__form">
        <div className="dialog__row dialog__row--between">
          <label className="field__label" htmlFor="tracklist-text">
            Строки вида «Исполнитель — Название»
          </label>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void pickFile()}>
            <Icon name="folder" size={15} />
            Открыть файл
          </button>
        </div>
        <textarea
          id="tracklist-text"
          className="input input--area"
          spellCheck={false}
          style={{ minHeight: 200 }}
          placeholder={'Кино — Звезда по имени Солнце\nАквариум — Город золотой\nМельница — Дорога сна'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      {entries.length > 0 ? (
        <div className="listpreview">
          <span className="listpreview__count">
            Распознано строк: {entries.length}
            {entries.length > PREVIEW ? ` (первые ${PREVIEW})` : ''}
          </span>
          <ul className="listpreview__list">
            {entries.slice(0, PREVIEW).map((entry, index) => (
              <li key={`${entry.raw}-${index}`} className="listpreview__row">
                <span className="listpreview__artist">{entry.artist || '—'}</span>
                <span className="listpreview__title">{entry.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="dialog__text">
          Поддерживаются: обычный текст, CSV с колонками «artist,title», плейлисты M3U/M3U8.
        </p>
      )}

      <div className="dialog__form">
        <label className="field__label" htmlFor="tracklist-name">
          Название плейлиста
        </label>
        <input
          id="tracklist-name"
          className="input"
          spellCheck={false}
          placeholder="Импортированный список"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="listimport__options">
        <Switch
          checked={fetchLyrics}
          onChange={setFetchLyrics}
          label="Загрузить тексты из LRCLIB"
        />
        <span className="field__hint">
          Открытая база сообщества. Единственный источник текстов в приложении.
        </span>

        <Switch
          checked={searchArchive}
          onChange={setSearchArchive}
          label="Искать звук в открытом архиве (archive.org)"
        />
        <span className="field__hint">
          Медленно: для каждой строки идёт отдельный поиск. Находят в основном общественное
          достояние и свободные лицензии.
        </span>
      </div>

      <p className="page__note">
        Аудио берётся только из того, что разрешено: ваши файлы, офлайн-загрузки и открытый архив.
        Названия и тексты защищённой музыки сохраняются, но звук для них приложение не добывает.
      </p>
    </Modal>
  )
}
