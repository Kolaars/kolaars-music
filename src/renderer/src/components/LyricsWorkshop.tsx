import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { LyricLine, Lyrics, Track } from '@shared/types'
import { formatTimestamp, parseTimestampInput } from '@shared/lrc'
import { useLyrics } from '../state/lyrics'
import { usePlayer } from '../state/player'
import { useApp } from '../state/store'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { formatTime } from '../lib/format'

export type WorkshopTab = 'text' | 'sync' | 'sources'

interface SyncLine {
  text: string
  time: number | null
}

const TABS: { id: WorkshopTab; label: string; icon: 'lyrics' | 'mic' | 'sparkles' }[] = [
  { id: 'text', label: 'Текст', icon: 'lyrics' },
  { id: 'sync', label: 'Синхронизация', icon: 'mic' },
  { id: 'sources', label: 'Источники', icon: 'sparkles' }
]

/** Non-empty lyric lines — blank lines are verse separators, not sung lines. */
function meaningfulLines(plain: string): string[] {
  return plain
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function LyricsWorkshop({
  track,
  tab,
  onClose
}: {
  track: Track
  tab: WorkshopTab | null
  onClose: () => void
}): JSX.Element | null {
  const saved = useLyrics((state) => state.saved)
  const bundled = useLyrics((state) => state.bundled)
  const candidates = useLyrics((state) => state.candidates)
  const wikisource = useLyrics((state) => state.wikisource)
  const bundledMatches = useLyrics((state) => state.bundledMatches)
  const searching = useLyrics((state) => state.searching)
  const saveLyrics = useLyrics((state) => state.save)

  const [active, setActive] = useState<WorkshopTab>('text')
  const [plain, setPlain] = useState('')
  const [lines, setLines] = useState<SyncLine[]>([])
  const [pointer, setPointer] = useState(0)
  const [query, setQuery] = useState('')
  const [queryLoaded, setQueryLoaded] = useState(false)

  const position = usePlayer((state) => (state.currentId === track.id ? state.position : 0))
  const duration = usePlayer((state) => (state.currentId === track.id ? state.duration : 0))
  const effectiveDuration = duration || track.duration || 0
  const positionRef = useRef(position)

  useEffect(() => {
    positionRef.current = position
  }, [position])

  const source: Lyrics | null = saved ?? bundled

  /* (Re)initialise the local draft whenever the modal opens. */
  useEffect(() => {
    if (!tab) return
    setActive(tab)
    const base = source
    const text = base?.plain ?? ''
    setPlain(text)

    if (base?.synced?.length) {
      setLines(base.synced.map((line) => ({ text: line.text, time: line.time })))
    } else {
      setLines(meaningfulLines(text).map((lineText) => ({ text: lineText, time: null })))
    }
    setPointer(0)
    setQueryLoaded(false)
    setQuery(`${track.title} ${track.artist}`.trim())
    // Intentionally only re-runs when the modal is (re)opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, track.id])

  /* Re-derive sync lines when the author edits the text tab. */
  useEffect(() => {
    if (active !== 'sync') return
    setLines((current) => {
      const texts = meaningfulLines(plain)
      const previous = new Map(current.map((line) => [line.text, line.time]))
      const next: SyncLine[] = texts.map((text, index) => ({
        text,
        time: previous.get(text) ?? current[index]?.time ?? null
      }))
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, plain])

  const mark = useCallback(
    (index: number) => {
      setLines((current) => {
        const next = [...current]
        if (!next[index]) return current
        next[index] = { ...next[index], time: Math.max(0, positionRef.current) }
        return next
      })
      setPointer((value) => Math.min(value + 1, Math.max(0, lines.length - 1)))
    },
    [lines.length]
  )

  /* Tap-to-sync: Space assigns the current playback time to the next line. */
  useEffect(() => {
    if (!tab || active !== 'sync') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      mark(pointer)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tab, active, mark, pointer])

  const missingTimes = lines.filter((line) => line.time == null).length

  const buildLyrics = (): Lyrics => {
    const synced: LyricLine[] = lines
      .filter((line): line is { text: string; time: number } => line.time != null)
      .map((line) => ({ text: line.text, time: line.time }))
      .sort((a, b) => a.time - b.time)

    return {
      trackId: track.id,
      plain,
      synced: synced.length > 0 ? synced : null,
      meta: source?.meta ?? {},
      origin: 'user',
      provider: null,
      language: source?.language ?? null,
      updatedAt: Date.now()
    }
  }

  const handleSave = async (): Promise<void> => {
    await saveLyrics(buildLyrics())
    useApp.getState().toast('Текст сохранён', 'success')
    onClose()
  }

  const shiftAll = (delta: number): void => {
    setLines((current) =>
      current.map((line) => (line.time == null ? line : { ...line, time: Math.max(0, line.time + delta) }))
    )
  }

  const autoDistribute = async (): Promise<void> => {
    if (!effectiveDuration) {
      useApp.getState().toast('Длительность трека ещё неизвестна — включите воспроизведение', 'error')
      return
    }
    const draft = await useLyrics.getState().draftTimings(plain, effectiveDuration)
    if (draft.length === 0) {
      useApp.getState().toast('Сначала введите текст', 'error')
      return
    }
    setLines(draft.map((line) => ({ text: line.text, time: line.time })))
    setPointer(0)
    useApp.getState().toast('Черновые метки расставлены — уточните их вручную', 'info')
  }

  const syncProgress = useMemo(() => {
    const total = lines.length || 1
    const done = lines.filter((line) => line.time != null).length
    return { done, total, percent: Math.round((done / total) * 100) }
  }, [lines])

  if (!tab) return null

  const headerSubtitle = `${track.artist} · ${formatTime(effectiveDuration)}`

  return (
    <Modal
      open
      onClose={onClose}
      title="Текст песни"
      subtitle={headerSubtitle}
      width={860}
      footer={
        <>
          <span className="modal__status">
            {source ? `Текущий источник: ${source.provider ?? source.origin}` : 'Текста пока нет'}
          </span>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void handleSave()}>
              <Icon name="check" size={16} />
              Сохранить
            </button>
          </div>
        </>
      }
    >
      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`tabs__item${active === entry.id ? ' tabs__item--active' : ''}`}
            onClick={() => setActive(entry.id)}
          >
            <Icon name={entry.icon} size={15} />
            {entry.label}
          </button>
        ))}
      </nav>

      {active === 'text' ? (
        <div className="workshop__section">
          <p className="workshop__hint">
            Введите текст построчно. Пустые строки используются как разделители куплетов и не влияют на
            синхронизацию.
          </p>
          <textarea
            className="input input--area workshop__textarea"
            value={plain}
            spellCheck={false}
            placeholder={'Первая строка\nВторая строка\n\nНовый куплет'}
            onChange={(event) => setPlain(event.target.value)}
          />
          <p className="workshop__meta">
            {meaningfulLines(plain).length} строк · {plain.length} символов
          </p>
        </div>
      ) : null}

      {active === 'sync' ? (
        <div className="workshop__section">
          <div className="syncbar">
            <button
              type="button"
              className="btn btn--primary syncbar__tap"
              onClick={() => mark(pointer)}
              disabled={pointer >= lines.length}
            >
              <Icon name="mic" size={16} />
              Отметить строку под номером {Math.min(pointer + 1, lines.length)} (пробел)
            </button>
            <div className="syncbar__controls">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPointer((value) => Math.max(0, value - 1))}
                title="Вернуться на строку назад"
              >
                <Icon name="chevron-left" size={15} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPointer((value) => Math.min(lines.length - 1, value + 1))}
                title="Пропустить строку"
              >
                <Icon name="chevron-right" size={15} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void autoDistribute()}
                title="Расставить метки равномерно по длительности"
              >
                <Icon name="equalizer" size={15} />
                Черновик
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => shiftAll(-0.5)}
                title="Сдвинуть всё на 0,5 с назад"
              >
                −0,5 с
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => shiftAll(0.5)}
                title="Сдвинуть всё на 0,5 с вперёд"
              >
                +0,5 с
              </button>
            </div>
          </div>

          <div className="progress-line" aria-hidden="true">
            <div className="progress-line__fill" style={{ width: `${syncProgress.percent}%` }} />
          </div>
          <p className="workshop__meta">
            Размечено {syncProgress.done} из {syncProgress.total}
            {missingTimes > 0 ? ` · без метки: ${missingTimes}` : ''}
          </p>

          <ol className="synclist">
            {lines.map((line, index) => (
              <li
                key={`${index}-${line.text}`}
                className={`synclist__row${index === pointer ? ' synclist__row--current' : ''}${
                  line.time != null ? ' synclist__row--done' : ''
                }`}
              >
                <button
                  type="button"
                  className="synclist__index"
                  onClick={() => {
                    setPointer(index)
                    if (line.time == null) mark(index)
                  }}
                  title="Отметить текущим временем"
                >
                  {index + 1}
                </button>
                <input
                  className="synclist__time"
                  value={line.time != null ? formatTimestamp(line.time) : ''}
                  placeholder="--:--.--"
                  onChange={(event) => {
                    const parsed = parseTimestampInput(event.target.value)
                    setLines((current) => {
                      const next = [...current]
                      next[index] = { ...next[index], time: parsed }
                      return next
                    })
                  }}
                />
                <span className="synclist__text">{line.text}</span>
                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title="Отметить временем воспроизведения"
                  onClick={() => mark(index)}
                >
                  <Icon name="clock" size={15} />
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title="Сбросить метку"
                  onClick={() =>
                    setLines((current) => {
                      const next = [...current]
                      next[index] = { ...next[index], time: null }
                      return next
                    })
                  }
                >
                  <Icon name="close" size={14} />
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title="Прослушать это место"
                  onClick={() => {
                    if (line.time == null) {
                      useApp.getState().toast('У строки ещё нет метки', 'info')
                      return
                    }
                    usePlayer.getState().seek(Math.max(0, line.time - 1.2))
                    usePlayer.getState().play()
                  }}
                >
                  <Icon name="play" size={13} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {active === 'sources' ? (
        <div className="workshop__section">
          <div className="searchbar searchbar--inline">
            <Icon name="search" size={16} />
            <input
              className="input"
              value={query}
              spellCheck={false}
              placeholder="Название и исполнитель"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void useLyrics.getState().searchSources(query)
                  setQueryLoaded(true)
                }
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={searching}
              onClick={() => {
                void useLyrics.getState().searchSources(query)
                setQueryLoaded(true)
              }}
            >
              {searching ? 'Поиск…' : 'Искать'}
            </button>
          </div>

          <section className="source-block">
            <header className="source-block__head">
              <h3>
                <Icon name="sparkles" size={15} />
                Открытый пак Kolaars
              </h3>
              <p>Тексты в общественном достоянии, работают без интернета.</p>
            </header>
            {bundledMatches.length === 0 ? (
              <p className="source-block__empty">Ничего не найдено. Попробуйте другой запрос.</p>
            ) : (
              <ul className="source-list">
                {bundledMatches.map((song) => (
                  <li key={song.id} className="source-list__row">
                    <div className="source-list__text">
                      <span className="source-list__title">{song.title}</span>
                      <span className="source-list__meta">
                        {song.artist}
                        {song.year ? ` · ${song.year}` : ''} · {song.license}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void useLyrics.getState().applyBundled(song.id)}
                    >
                      Применить
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="source-block">
            <header className="source-block__head">
              <h3>
                <Icon name="globe" size={15} />
                LRCLIB — открытая база с синхронными текстами
              </h3>
              <p>Ищет по исполнителю, названию и длительности; часто есть караоке-разметка.</p>
            </header>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={searching}
              onClick={() => void useLyrics.getState().searchOnline(track)}
            >
              <Icon name="search" size={15} />
              Искать в LRCLIB
            </button>
            {candidates.length > 0 ? (
              <ul className="source-list">
                {candidates.map((candidate, index) => (
                  <li key={`${candidate.plain.length}-${index}`} className="source-list__row">
                    <div className="source-list__text">
                      <span className="source-list__title">
                        {candidate.meta?.title ?? track.title}
                        {candidate.synced?.length ? (
                          <span className="badge badge--accent">
                            <Icon name="mic" size={11} />
                            караоке
                          </span>
                        ) : null}
                      </span>
                      <span className="source-list__meta">
                        {candidate.meta?.artist ?? track.artist}
                        {candidate.meta?.length ? ` · ${formatTime(Number(candidate.meta.length))}` : ''} ·{' '}
                        {candidate.plain.slice(0, 60).replace(/\n/g, ' ')}…
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void useLyrics.getState().adopt(candidate)}
                    >
                      Применить
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="source-block">
            <header className="source-block__head">
              <h3>
                <Icon name="book" size={15} />
                Wikisource — тексты в общественном достоянии
              </h3>
              <p>Проверенный источник для песен, опубликованных до 1931 года.</p>
            </header>
            {wikisource.length === 0 ? (
              <p className="source-block__empty">
                {queryLoaded ? 'Совпадений нет.' : 'Введите запрос и нажмите «Искать».'}
              </p>
            ) : (
              <ul className="source-list">
                {wikisource.map((hit) => (
                  <li key={hit.pageId} className="source-list__row">
                    <div className="source-list__text">
                      <span className="source-list__title">{hit.title}</span>
                      <span className="source-list__meta">{hit.snippet}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void useLyrics.getState().applyWikisource(hit.title)}
                    >
                      Применить
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  )
}
