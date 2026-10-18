/** About + legal information: sources, licences and the bundled lyrics pack. */

import { useEffect, useMemo, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { useApp } from '../state/store'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { SectionCard } from '../components/Controls'
import type { BundledSong } from '../../../preload/index'

interface PackInfo {
  name: string
  version: string
  license: string
  note: string
  count: number
  songs: BundledSong[]
}

const LINKS = [
  { label: 'Internet Archive', url: 'https://archive.org' },
  { label: 'Great 78 Project', url: 'https://archive.org/details/georgeblood' },
  { label: 'Musopen', url: 'https://musopen.org' },
  { label: 'LRCLIB', url: 'https://lrclib.net' },
  { label: 'Wikisource', url: 'https://en.wikisource.org' },
  { label: 'Исходный код на GitHub', url: 'https://github.com/kolaars/kolaars-music' }
]

export function AboutView(): JSX.Element {
  const appInfo = useApp((state) => state.appInfo)
  const [pack, setPack] = useState<PackInfo | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void api.lyrics
      .packInfo()
      .then(setPack)
      .catch(() => undefined)
  }, [])

  const songs = useMemo(() => {
    if (!pack) return []
    const needle = filter.trim().toLowerCase()
    const list = needle
      ? pack.songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(needle))
      : pack.songs
    return list.slice(0, 120)
  }, [pack, filter])

  return (
    <Page className="page--about">
      <PageHeader icon="info" title="О программе" subtitle="Открытый музыкальный проигрыватель с открытыми текстами" />

      <section className="abouthero">
        <span className="abouthero__logo">
          <Icon name="equalizer" size={34} />
        </span>
        <div className="abouthero__text">
          <h1>Kolaars Music</h1>
          <p>
            Версия {appInfo?.version ?? '1.1.0'} · бесплатно, с открытым исходным кодом, без регистрации и
            отслеживания.
          </p>
          <div className="abouthero__badges">
            <span className="badge badge--accent">
              <Icon name="shield" size={12} />
              MIT
            </span>
            <span className="badge">Electron {appInfo?.electron ?? '—'}</span>
            <span className="badge">Chromium {appInfo?.chrome ?? '—'}</span>
            <span className="badge">Node {appInfo?.node ?? '—'}</span>
            <span className="badge">{appInfo?.seedTracks ?? 0} треков в каталоге</span>
          </div>
        </div>
      </section>

      <SectionCard icon="music" title="Откуда музыка" description="Только легальные, свободно распространяемые записи">
        <p className="prose">
          Встроенный каталог собран из открытых коллекций Internet Archive. Это оцифрованные шеллачные пластинки
          Great&nbsp;78 Project, записи Musopen, переданные в общественное достояние, и релизы независимых лейблов
          (netlabels) под лицензиями Creative&nbsp;Commons. Каждая запись содержит ссылку на первоисточник и
          сведения о лицензии — их видно в карточке трека и на экране воспроизведения.
        </p>
        <ul className="linklist">
          {LINKS.map((link) => (
            <li key={link.url}>
              <button type="button" className="linklike" onClick={() => void api.app.openExternal(link.url)}>
                <Icon name="external" size={14} />
                {link.label}
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        icon="lyrics"
        title="Тексты песен"
        description={pack ? `${pack.name} v${pack.version} · ${pack.license}` : 'Загрузка сведений о паке…'}
      >
        <p className="prose">
          {pack?.note ??
            'Сборник текстов песен, находящихся в общественном достоянии, входит в поставку и работает без интернета.'}
        </p>
        <p className="prose prose--muted">
          Онлайн-поиск текстов идёт через открытую базу <strong>LRCLIB</strong> (синхронизированные тексты от
          сообщества) и <strong>Wikisource</strong> (проверенные тексты в общественном достоянии). Обращения
          выполняются только по вашему действию и отключаются в настройках.
        </p>

        {pack && pack.songs.length > 0 ? (
          <>
            <div className="searchbar searchbar--inline">
              <Icon name="search" size={16} />
              <input
                className="input"
                value={filter}
                spellCheck={false}
                placeholder={`Поиск среди ${pack.count} песен`}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <ul className="songlist">
              {songs.map((song) => (
                <li key={song.id} className="songlist__row">
                  <span className="songlist__title">{song.title}</span>
                  <span className="songlist__meta">
                    {song.artist}
                    {song.year ? ` · ${song.year}` : ''}
                    {song.language ? ` · ${song.language}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {pack.songs.length > songs.length ? (
              <p className="page__note">Показаны первые {songs.length} совпадений — уточните запрос.</p>
            ) : null}
          </>
        ) : null}
      </SectionCard>

      <SectionCard icon="shield" title="Конфиденциальность" description="Никаких аккаунтов и телеметрии">
        <p className="prose">
          Kolaars Music не собирает статистику и не отправляет данные на наши серверы — их попросту нет. Вся
          библиотека, плейлисты, тексты и настройки хранятся у вас на диске: по одному файлу{' '}
          <code>kolaars.json</code> на профиль. Профили — это просто отдельные библиотеки на одном
          компьютере; входа, пароля и синхронизации нет. Сеть используется только для обращения к открытым
          API Internet Archive, LRCLIB и Wikisource, и только когда это нужно для показа или
          воспроизведения записи.
        </p>
        <p className="prose prose--muted">
          Импорт списка треков сопоставляет названия и не обращается к закрытым сервисам (Яндекс.Музыка,
          Spotify, Genius). Для музыки, защищённой авторским правом, свободного источника звука не
          существует — такая строка сохраняется как название и текст без аудио.
        </p>
        <p className="prose prose--muted">
          Программа предоставляется «как есть». Ответственность за соблюдение условий лицензий на отдельные
          записи и тексты лежит на источнике; ссылки и лицензии указаны для каждой записи.
        </p>
      </SectionCard>
    </Page>
  )
}
