import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Track } from '@shared/types'
import { activeLyrics, lineIndexAt, useLyrics } from '../state/lyrics'
import { useApp } from '../state/store'
import { usePlayer } from '../state/player'
import { Icon } from './Icon'
import { MenuButton } from './MenuButton'
import { EmptyState } from './Feedback'
import { LyricsWorkshop, type WorkshopTab } from './LyricsWorkshop'

export interface LyricsPanelProps {
  track: Track | null
  /** `panel` is the docked right-hand column, `full` the Now Playing screen. */
  variant?: 'panel' | 'full'
}

const ORIGIN_LABEL: Record<string, string> = {
  user: 'Ваш текст',
  'lrc-file': 'Импортирован из .lrc',
  pack: 'Открытый пак Kolaars',
  lrclib: 'LRCLIB',
  wikisource: 'Wikisource'
}

export function LyricsPanel({ track, variant = 'panel' }: LyricsPanelProps): JSX.Element {
  const lyrics = useLyrics(activeLyrics)
  const loading = useLyrics((state) => state.loading)
  const saved = useLyrics((state) => state.saved)

  const [workshop, setWorkshop] = useState<WorkshopTab | null>(null)
  const requestedTab = useApp((state) => state.lyricsTab)

  // The application menu can ask for the workshop to open on a given tab.
  useEffect(() => {
    if (!requestedTab) return
    setWorkshop(requestedTab)
    useApp.setState({ lyricsTab: null })
  }, [requestedTab, track?.id])

  const position = usePlayer((state) => (state.currentId === track?.id ? state.position : 0))
  const scrollRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])
  const userScrolledAt = useRef(0)

  const synced = lyrics?.synced ?? null
  const activeIndex = useMemo(
    () => (track && synced ? lineIndexAt(synced, position) : -1),
    [synced, position, track]
  )

  // Follow the music, but get out of the way as soon as the user scrolls.
  useEffect(() => {
    if (activeIndex < 0) return
    if (Date.now() - userScrolledAt.current < 4000) return
    const container = scrollRef.current
    const line = lineRefs.current[activeIndex]
    if (!container || !line) return
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex])

  const markUserScroll = (): void => {
    userScrolledAt.current = Date.now()
  }

  const openWorkshop = (tab: WorkshopTab): void => setWorkshop(tab)

  if (!track) {
    return (
      <div className={`lyrics lyrics--${variant}`}>
        <EmptyState
          icon="lyrics"
          title="Текст появится здесь"
          text="Включите трек, чтобы увидеть текст и караоке-подсветку."
          compact={variant === 'panel'}
        />
      </div>
    )
  }

  const menuItems = [
    {
      label: 'Найти в открытых базах',
      icon: 'sparkles' as const,
      onSelect: () => {
        void useLyrics.getState().searchOnline(track)
        openWorkshop('sources')
      }
    },
    {
      label: 'Редактировать текст',
      icon: 'pencil' as const,
      onSelect: () => openWorkshop('text')
    },
    {
      label: 'Синхронизировать (караоке)',
      icon: 'mic' as const,
      onSelect: () => openWorkshop('sync')
    },
    {
      label: 'Импортировать .lrc',
      icon: 'upload' as const,
      separatorBefore: true,
      onSelect: () => void useLyrics.getState().importFromFile(track)
    },
    {
      label: 'Экспортировать .lrc',
      icon: 'download' as const,
      disabled: !lyrics,
      onSelect: () => void useLyrics.getState().exportToFile(track)
    },
    {
      label: 'Удалить пользовательский текст',
      icon: 'trash' as const,
      danger: true,
      disabled: !saved,
      separatorBefore: true,
      onSelect: () => void useLyrics.getState().remove(track.id)
    }
  ]

  return (
    <div className={`lyrics lyrics--${variant}`}>
      <header className="lyrics__head">
        <div className="lyrics__headtext">
          <span className="lyrics__eyebrow">
            <Icon name="lyrics" size={14} />
            {lyrics ? (ORIGIN_LABEL[lyrics.origin] ?? 'Текст') : 'Текст песни'}
            {lyrics?.synced?.length ? ' · синхронизирован' : ''}
          </span>
          <h2 className="lyrics__title">{track.title}</h2>
          <p className="lyrics__artist">{track.artist}</p>
        </div>
        <MenuButton
          items={menuItems}
          icon="more"
          title="Действия с текстом"
          className="iconbtn"
        />
      </header>

      {loading ? (
        <div className="lyrics__scroll" ref={scrollRef}>
          <div className="lyrics__plain">
            <p>Загрузка текста…</p>
          </div>
        </div>
      ) : !lyrics ? (
        <EmptyState
          icon="lyrics"
          title="Текста пока нет"
          text="Можно взять текст из открытого пака в общественном достоянии, найти его в открытых базах или ввести свой."
          action={{ label: 'Найти текст', icon: 'sparkles', onClick: () => openWorkshop('sources') }}
          compact={variant === 'panel'}
        />
      ) : synced && synced.length > 0 ? (
        <div className="lyrics__scroll" ref={scrollRef} onWheel={markUserScroll} onTouchMove={markUserScroll}>
          <div className="lyrics__lines">
            {synced.map((line, index) => (
              <p
                key={`${line.time}-${index}`}
                ref={(element) => {
                  lineRefs.current[index] = element
                }}
                className={`lyrics__line${index === activeIndex ? ' lyrics__line--active' : ''}${
                  index < activeIndex ? ' lyrics__line--past' : ''
                }`}
                onClick={() => usePlayer.getState().seek(line.time)}
                title="Перейти к этой строке"
              >
                {line.text}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <div className="lyrics__scroll" ref={scrollRef} onWheel={markUserScroll}>
          <div className="lyrics__plain">
            {lyrics.plain.split('\n').map((line, index) =>
              line.trim() ? <p key={index}>{line}</p> : <br key={index} />
            )}
          </div>
          <button type="button" className="lyrics__cta" onClick={() => openWorkshop('sync')}>
            <Icon name="mic" size={16} />
            Добавить синхронизацию для караоке
          </button>
        </div>
      )}

      <LyricsWorkshop track={track} tab={workshop} onClose={() => setWorkshop(null)} />
    </div>
  )
}
