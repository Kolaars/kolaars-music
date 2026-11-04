/** Settings — theme, playback, sources and local data. */

import { useEffect, useState, type JSX } from 'react'
import type { DiscordRpcStatus, LanguageSetting, Profile, ThemeMode } from '@shared/types'
import { DEFAULT_FORMAT_PRIORITY } from '@shared/defaults'
import { api } from '../lib/api'
import { useApp } from '../state/store'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { Field, Range, SectionCard, Select, Switch } from '../components/Controls'
import { ConfirmModal, PromptModal } from '../components/Dialogs'
import { useUpdates } from '../state/updates'
import { formatBytes, formatRelativeDate } from '../lib/format'
import { t } from '../lib/i18n'

const ACCENTS = ['#7c5cff', '#4f8cff', '#22c1a4', '#f4b740', '#ff6b6b', '#ff5ea8', '#8ce563', '#00b8d9']

export function SettingsView(): JSX.Element {
  const settings = useApp((state) => state.settings)
  const appInfo = useApp((state) => state.appInfo)
  const isAndroid = appInfo?.platform === 'android'
  const updateSettings = useApp((state) => state.updateSettings)
  const setRoute = useApp((state) => state.setRoute)

  const pickDownloadDir = async (): Promise<void> => {
    const dir = await api.local.pickDownloadDir()
    if (dir) void updateSettings({ downloadDir: dir })
  }

  return (
    <Page className="page--settings">
      <PageHeader
        icon="settings"
        title={t('Настройки')}
        subtitle={t('Всё хранится локально, в одном файле kolaars.json в папке данных приложения')}
      />

      <ProfilesCard />

      <SectionCard icon="sparkles" title={t('Внешний вид')} description={t('Тема оформления и акцентный цвет')}>
        <Field label={t('Тема')} hint={t('Тёмная, светлая или как в системе')}>
          <Select<ThemeMode>
            label={t('Тема')}
            value={settings.theme}
            onChange={(value) => void updateSettings({ theme: value })}
            options={[
              { value: 'dark', label: t('Тёмная') },
              { value: 'light', label: t('Светлая') },
              { value: 'system', label: t('Как в системе') }
            ]}
          />
        </Field>

        <Field label={t('Акцентный цвет')} hint={t('Используется для кнопок, ползунков и активных элементов')}>
          <div className="swatches">
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${settings.accent.toLowerCase() === color ? ' swatch--active' : ''}`}
                style={{ ['--swatch' as string]: color }}
                title={color}
                onClick={() => void updateSettings({ accent: color })}
              />
            ))}
            <label className="swatch swatch--custom" title={t('Свой цвет')}>
              <Icon name="pencil" size={13} />
              <input
                type="color"
                value={settings.accent}
                onChange={(event) => void updateSettings({ accent: event.target.value })}
              />
            </label>
          </div>
        </Field>

        <Field
          label={t('Язык интерфейса')}
          hint={t('Русский, английский или язык системы. Интерфейс переключается сразу.')}
        >
          <Select<LanguageSetting>
            label={t('Язык интерфейса')}
            value={settings.language ?? 'ru'}
            onChange={(value) => void updateSettings({ language: value })}
            options={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
              { value: 'system', label: t('Как в системе') }
            ]}
          />
        </Field>
      </SectionCard>

      <SectionCard
        icon="equalizer"
        title={t('Воспроизведение')}
        description={isAndroid ? t('Поведение плеера при запуске') : t('Громкость, переходы и уведомления')}
      >
        {/* Loudness trim, crossfade and normalisation exist only in the desktop
            audio pipeline; on Android they would be switches that do nothing. */}
        {isAndroid ? null : (
          <>
            <Field label={t('Громкость по умолчанию')} hint={t('Дополнительная коррекция громкости для всех треков')}>
              <Range
                label={t('Коррекция громкости')}
                min={-12}
                max={12}
                step={1}
                value={settings.volumeTrim}
                onChange={(value) => void updateSettings({ volumeTrim: value })}
                format={(value) => t('{0}{1} дБ', { 0: value > 0 ? '+' : '', 1: value })}
              />
            </Field>

            <Field label={t('Плавный переход')} hint={t('Кроссфейд между треками, в секундах (0 — выключен)')}>
              <Range
                label={t('Кроссфейд')}
                min={0}
                max={8}
                step={0.5}
                value={settings.crossfade}
                onChange={(value) => void updateSettings({ crossfade: value })}
                format={(value) => (value === 0 ? t('выключен') : t('{0} с', { 0: value }))}
              />
            </Field>

            <Field label={t('Нормализация громкости')} hint={t('Выравнивает громкость между записями разных лет')}>
              <Switch
                label={t('Нормализация громкости')}
                checked={settings.normalizeLoudness}
                onChange={(value) => void updateSettings({ normalizeLoudness: value })}
              />
            </Field>
          </>
        )}

        <Field label={t('Продолжать с места остановки')} hint={t('Сохранять очередь, трек и позицию между запусками')}>
          <Switch
            label={t('Продолжать с места остановки')}
            checked={settings.resumeSession}
            onChange={(value) => void updateSettings({ resumeSession: value })}
          />
        </Field>

        {isAndroid ? null : (
          <Field label={t('Уведомления')} hint={t('Показывать системное уведомление при смене трека')}>
            <Switch
              label={t('Уведомления')}
              checked={settings.notifications}
              onChange={(value) => void updateSettings({ notifications: value })}
            />
          </Field>
        )}
      </SectionCard>

      <SectionCard
        icon="globe"
        title={t('Источники')}
        description={t('Kolaars работает офлайн из встроенного каталога. Онлайн-источники включаются отдельно')}
      >
        <Field label={t('Онлайн-источники')} hint={t('Разрешить обращения к Internet Archive, LRCLIB, Wikisource и подключённым сервисам')}>
          <Switch
            label={t('Онлайн-источники')}
            checked={settings.onlineProviders}
            onChange={(value) => void updateSettings({ onlineProviders: value })}
          />
        </Field>

        <Field label="Internet Archive" hint={t('Поиск и подборки из коллекций архива')}>
          <Switch
            label="Internet Archive"
            checked={settings.providers.archive}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, archive: value } })}
          />
        </Field>

        <Field label="LRCLIB" hint={t('Открытая база текстов, в том числе синхронизированных')}>
          <Switch
            label="LRCLIB"
            checked={settings.providers.lrclib}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, lrclib: value } })}
          />
        </Field>

        <Field label="Wikisource" hint={t('Проверенные тексты в общественном достоянии')}>
          <Switch
            label="Wikisource"
            checked={settings.providers.wikisource}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, wikisource: value } })}
          />
        </Field>

        <Field
          label="YouTube"
          hint={t('Поиск через официальный API, звук — во встроенном плеере YouTube')}
        >
          <Switch
            label="YouTube"
            checked={settings.providers.youtube}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, youtube: value } })}
          />
        </Field>

        <Field
          label="SoundCloud"
          hint={t('Поиск через официальный API, звук — в официальном Widget Player')}
        >
          <Switch
            label="SoundCloud"
            checked={settings.providers.soundcloud}
            onChange={(value) =>
              void updateSettings({ providers: { ...settings.providers, soundcloud: value } })
            }
          />
        </Field>

        <Field label={t('Предпочитать lossless')} hint={t('Если у записи есть FLAC/WAV, выбирать его вместо MP3')}>
          <Switch
            label={t('Предпочитать lossless')}
            checked={settings.preferLossless}
            onChange={(value) => void updateSettings({ preferLossless: value })}
          />
        </Field>
      </SectionCard>

      {isAndroid ? null : <DiscordCard />}

      {isAndroid ? null : (
        <SectionCard icon="folder" title={t('Файлы')} description={t('Где хранятся офлайн-копии')}>
          <Field label={t('Папка загрузок')} hint={t('Пусто — используется папка данных приложения')}>
            <div className="field__row">
              <span className="field__path" title={settings.downloadDir || appInfo?.downloadsDir}>
                {settings.downloadDir || appInfo?.downloadsDir || t('по умолчанию')}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void pickDownloadDir()}>
                <Icon name="folder" size={15} />
                {t('Выбрать')}</button>
              {settings.downloadDir ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void updateSettings({ downloadDir: '' })}
                >{t('Сбросить')}</button>
              ) : null}
            </div>
          </Field>

          <Field label={t('Папка данных')} hint={t('Здесь лежит kolaars.json, обложки из тегов и загрузки по умолчанию')}>
            <div className="field__row">
              <span className="field__path" title={appInfo?.userData}>
                {appInfo?.userData ?? '—'}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!appInfo?.userData}
                onClick={() => appInfo?.userData && void api.local.reveal(appInfo.userData)}
              >
                <Icon name="external" size={15} />
                {t('Открыть')}</button>
            </div>
          </Field>
        </SectionCard>
      )}

      {isAndroid ? null : (
        <SectionCard
          icon="music"
          title={t('Формат файлов')}
          description={t('Какой файл оставить, если одна и та же песня лежит на диске в нескольких форматах')}
        >
          <FormatPriorityList />
        </SectionCard>
      )}

      {isAndroid ? null : <UpdatesCard />}

      <SectionCard icon="shield" title={t('Правовая информация')} description={t('Лицензии, источники и благодарности')}>
        <Field label={t('Код приложения')} hint={t('Kolaars Music распространяется под лицензией MIT')}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRoute({ name: 'about' })}>
            <Icon name="info" size={15} />
            {t('Открыть раздел «О программе»')}</button>
        </Field>
      </SectionCard>
    </Page>
  )
}

/* ------------------------------------------------------------------ */
/* Updates                                                             */
/* ------------------------------------------------------------------ */

function UpdatesCard(): JSX.Element {
  const settings = useApp((state) => state.settings)
  const updateSettings = useApp((state) => state.updateSettings)
  const update = useUpdates((state) => state.update)
  const check = useUpdates((state) => state.check)
  const download = useUpdates((state) => state.download)
  const install = useUpdates((state) => state.install)
  const openRelease = useUpdates((state) => state.openRelease)

  useEffect(() => {
    void useUpdates.getState().init()
  }, [])

  const busy = update.status === 'checking' || update.status === 'downloading'
  const version = update.version ?? ''
  const percent = update.progress?.percent ?? 0
  const canInstall = update.canInstall

  const statusLabel = ((): string => {
    switch (update.status) {
      case 'checking':
        return t('Проверяем…')
      case 'available':
        return t('Доступна версия {0}', { 0: version })
      case 'up-to-date':
        return t('У вас последняя версия')
      case 'downloading':
        return t('Загружаем обновление… {0}%', { 0: percent })
      case 'ready':
        return t('Обновление скачано')
      case 'error':
        return t('Не удалось проверить обновление')
      default:
        return t('Проверка ещё не выполнялась')
    }
  })()

  const statusHint = ((): string => {
    switch (update.status) {
      case 'checking':
        return t('Запрашиваем последний выпуск на GitHub.')
      case 'available':
        return canInstall
          ? t('Нажмите «Скачать обновление» — установка займёт пару минут.')
          : t('Скачайте файл со страницы релиза и запустите его.')
      case 'up-to-date':
        return update.checkedAt
          ? t('Проверено {0}.', { 0: formatRelativeDate(update.checkedAt) })
          : t('Можно проверить вручную в любой момент.')
      case 'downloading':
        return t('{0} из {1}', {
          0: formatBytes(update.progress?.transferred),
          1: formatBytes(update.progress?.total)
        })
      case 'ready':
        return t('Приложение перезапустится и заменит файлы. Библиотека и настройки сохранятся.')
      case 'error':
        return update.error ?? t('Не удалось проверить обновления.')
      default:
        return t('Можно проверить вручную в любой момент.')
    }
  })()

  const statusClass =
    update.status === 'error'
      ? 'badge badge--error'
      : update.status === 'up-to-date' || update.status === 'ready'
        ? 'badge badge--done'
        : update.status === 'available' || update.status === 'checking' || update.status === 'downloading'
          ? 'badge badge--accent'
          : 'badge'

  return (
    <SectionCard
      icon="refresh"
      title={t('Обновления')}
      description={t('Новая версия скачивается и устанавливается прямо из приложения')}
    >
      <Field label={t('Текущая версия')} hint={t('Номер этой сборки Kolaars Music')}>
        <span className="badge">{update.currentVersion || '—'}</span>
      </Field>

      <Field
        label={t('Автоматическая проверка')}
        hint={t('При запуске приложение спрашивает у GitHub, есть ли новая версия. Данные о вас и вашей библиотеке не отправляются.')}
      >
        <Switch
          label={t('Автоматическая проверка')}
          checked={settings.autoCheckUpdates}
          onChange={(value) => void updateSettings({ autoCheckUpdates: value })}
        />
      </Field>

      <Field label={t('Состояние')} hint={statusHint}>
        <span className={statusClass}>{statusLabel}</span>
      </Field>

      {update.status === 'downloading' ? (
        <div className="updateprogress" aria-hidden="true">
          <span style={{ width: `${Math.max(2, percent)}%` }} />
        </div>
      ) : null}

      <div className="field__row">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() => void check(true)}
        >
          <Icon name="refresh" size={15} />
          {update.status === 'checking' ? t('Проверяем…') : t('Проверить обновления')}
        </button>

        {update.status === 'available' && canInstall ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void download()}>
            <Icon name="download" size={15} />
            {t('Скачать обновление')}
          </button>
        ) : null}

        {update.status === 'available' && !canInstall ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openRelease()}>
            <Icon name="external" size={15} />
            {t('Открыть страницу релиза')}
          </button>
        ) : null}

        {update.status === 'ready' ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void install()}>
            <Icon name="sparkles" size={15} />
            {t('Перезапустить и обновить')}
          </button>
        ) : null}
      </div>

      {update.installReason === 'portable' ? (
        <p className="page__note">
          {t('Портативная версия не может заменить сама себя. Скачайте новый файл со страницы релиза и замените им старый — библиотека в папке данных останется на месте.')}
        </p>
      ) : null}

      {update.status === 'available' && !canInstall && update.installReason !== 'portable' ? (
        <p className="page__note">
          {t('Эта сборка не умеет устанавливать обновления сама — скачайте новый выпуск со страницы релиза.')}
        </p>
      ) : null}

      {update.status === 'error' ? (
        <p className="page__note">
          {t('Проверка обращается только к публичным релизам на GitHub. Если сеть недоступна, попробуйте позже или откройте страницу релиза вручную.')}
        </p>
      ) : null}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ */
/* Discord Rich Presence                                               */
/* ------------------------------------------------------------------ */

const DISCORD_DEVELOPER_PORTAL = 'https://discord.com/developers/applications'
const DISCORD_ID_RE = /^\d{17,20}$/

function DiscordCard(): JSX.Element {
  const settings = useApp((state) => state.settings)
  const updateSettings = useApp((state) => state.updateSettings)
  const [status, setStatus] = useState<DiscordRpcStatus | null>(null)
  const [draft, setDraft] = useState(settings.discordRpcClientId)

  useEffect(() => {
    setDraft(settings.discordRpcClientId)
  }, [settings.discordRpcClientId])

  useEffect(() => {
    let live = true
    void api.discord
      .status()
      .then((next) => {
        if (live) setStatus(next)
      })
      .catch(() => undefined)
    const off = api.discord.onStatus((next) => setStatus(next))
    return () => {
      live = false
      off()
    }
  }, [])

  const trimmed = draft.trim()
  const idValid = trimmed === '' || DISCORD_ID_RE.test(trimmed)
  const idChanged = trimmed !== settings.discordRpcClientId.trim()

  const saveId = (): void => {
    if (!idChanged || !idValid) return
    void updateSettings({ discordRpcClientId: trimmed })
  }

  const statusMeta = describeDiscordStatus(status, settings.discordRpc, Boolean(settings.discordRpcClientId))

  return (
    <SectionCard
      icon="link"
      title="Discord Rich Presence"
      description={t('Текущий трек в профиле Discord — по желанию, только на этом компьютере')}
    >
      <Field
        label={t('Показывать в Discord')}
        hint={t('Discord должен быть запущен как приложение для Windows. В браузерной версии Discord RPC не работает.')}
      >
        <Switch
          label={t('Показывать в Discord')}
          checked={settings.discordRpc}
          onChange={(value) => void updateSettings({ discordRpc: value })}
        />
      </Field>

      <Field
        label="Application ID"
        hint={t('Встроенный идентификатор официального приложения Kolaars Music. Менять не нужно — поле оставлено для сборок с собственным приложением Discord.')}
      >
        <div className="field__row">
          <input
            className={`input discord__input${idValid ? '' : ' discord__input--invalid'}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            aria-label="Discord Application ID"
            aria-invalid={!idValid}
            placeholder="123456789012345678"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveId}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveId()
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!idChanged || !idValid}
            onClick={saveId}
          >{t('Сохранить')}</button>
        </div>
      </Field>

      <Field label={t('Состояние')} hint={statusMeta.hint}>
        <span className={statusMeta.className}>{statusMeta.label}</span>
      </Field>

      <p className="page__note discord__note">
        <span>{t('Application ID официального приложения уже встроен. Кнопка «Скачать» появляется только у открытых записей Internet Archive и ведёт на прямой файл. Для YouTube Music и SoundCloud кнопка открывает страницу сервиса, а локальные файлы остаются без кнопки — Discord не умеет запускать действия внутри плеера.')}</span>
        <button
          type="button"
          className="linklike"
          onClick={() => void api.app.openExternal(DISCORD_DEVELOPER_PORTAL)}
        >{t('Своё приложение')}</button>
      </p>
    </SectionCard>
  )
}

function describeDiscordStatus(
  status: DiscordRpcStatus | null,
  enabled: boolean,
  hasClientId: boolean
): { label: string; className: string; hint: string } {
  if (!enabled) {
    return {
      label: t('Выключено'),
      className: 'badge',
      hint: t('Rich Presence выключен — приложение не подключается к Discord.')
    }
  }
  if (!hasClientId) {
    return {
      label: t('Нужен Application ID'),
      className: 'badge badge--accent',
      hint: t('Вставьте Application ID приложения Discord выше и нажмите «Сохранить».')
    }
  }
  if (!status) {
    return { label: t('Проверяем…'), className: 'badge', hint: t('Читаем состояние подключения.') }
  }

  switch (status.state) {
    case 'connected':
      return {
        label: t('Подключено'),
        className: 'badge badge--done',
        hint: t('Discord запущен и показывает текущий трек.')
      }
    case 'connecting':
      return {
        label: t('Подключение…'),
        className: 'badge badge--accent',
        hint: t('Ищем локальный клиент Discord.')
      }
    case 'missing-client-id':
      return {
        label: t('Нужен Application ID'),
        className: 'badge badge--accent',
        hint: status.error ?? t('Укажите Application ID приложения Discord.')
      }
    case 'error':
      return {
        label: t('Нет подключения'),
        className: 'badge badge--error',
        hint: status.error ?? t('Discord не запущен или RPC недоступен.')
      }
    case 'disabled':
      return {
        label: t('Ожидание…'),
        className: 'badge',
        hint: t('Ждём подтверждения от главного процесса.')
      }
    default:
      return {
        label: t('Выключено'),
        className: 'badge',
        hint: t('Rich Presence выключен.')
      }
  }
}

/* ------------------------------------------------------------------ */
/* Format priority                                                     */
/* ------------------------------------------------------------------ */

/** Human names for the containers the app can read. */
const FORMAT_LABELS: Record<string, string> = {
  '.flac': 'FLAC — без потерь',
  '.wav': 'WAV — без потерь',
  '.aiff': 'AIFF — без потерь',
  '.aif': 'AIFF — без потерь',
  '.ape': 'Monkey’s Audio — без потерь',
  '.wv': 'WavPack — без потерь',
  '.m4a': 'M4A / AAC',
  '.m4b': 'M4B / AAC — аудиокнига',
  '.opus': 'Opus',
  '.ogg': 'OGG Vorbis',
  '.oga': 'OGG Audio',
  '.mp3': 'MP3',
  '.aac': 'AAC',
  '.wma': 'WMA',
  '.mpc': 'Musepack'
}

/**
 * The order in which local formats win. A folder downloaded from a music
 * service usually holds the same song as `.flac` and as `.m4a`; the importer
 * keeps whichever comes first here and leaves the other file on disk untouched.
 */
function FormatPriorityList(): JSX.Element {
  const priority = useApp((state) => state.settings.formatPriority ?? DEFAULT_FORMAT_PRIORITY)
  const updateSettings = useApp((state) => state.updateSettings)

  const move = (index: number, delta: number): void => {
    const next = [...priority]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    void updateSettings({ formatPriority: next })
  }

  return (
    <>
      <ol className="formatlist">
        {priority.map((extension, index) => (
          <li key={extension} className="formatlist__row">
            <span className="formatlist__rank">{index + 1}</span>
            <span className="formatlist__name">{t(FORMAT_LABELS[extension] ?? extension)}</span>
            <span className="formatlist__ext">{extension}</span>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              title={t('Выше')}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <Icon name="chevron-up" size={15} />
            </button>
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              title={t('Ниже')}
              disabled={index === priority.length - 1}
              onClick={() => move(index, 1)}
            >
              <Icon name="chevron-down" size={15} />
            </button>
          </li>
        ))}
      </ol>

      <div className="field__row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void updateSettings({ formatPriority: [...DEFAULT_FORMAT_PRIORITY] })}
        >
          <Icon name="refresh" size={15} />
          {t('Вернуть порядок по умолчанию')}</button>
      </div>

      <p className="page__note">{t('При импорте папки на каждую песню остаётся только лучший по этому списку файл: остальные не попадают в библиотеку, но и не удаляются с диска. Уже добавленные треки приложение не подменяет — иначе разъехались бы плейлисты и избранное.')}</p>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function createdLabel(at: number): string {
  try {
    return new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

/**
 * Local profiles: independent libraries on one machine. There is no account and
 * no network involved — a profile is a directory (`userData/profiles/<id>/`)
 * holding the whole library: tracks, playlists, lyrics, covers and downloads.
 */
function ProfilesCard(): JSX.Element {
  const profiles = useApp((state) => state.profiles)
  const activeProfileId = useApp((state) => state.activeProfileId)
  const appInfo = useApp((state) => state.appInfo)
  const switchProfile = useApp((state) => state.switchProfile)
  const createProfile = useApp((state) => state.createProfile)
  const renameProfile = useApp((state) => state.renameProfile)
  const deleteProfile = useApp((state) => state.deleteProfile)

  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Profile | null>(null)
  const [removing, setRemoving] = useState<Profile | null>(null)

  const active = profiles.find((profile) => profile.id === activeProfileId)

  return (
    <>
      <SectionCard
        icon="library"
        title={t('Профили')}
        description={t('Несколько независимых библиотек на одном компьютере — без аккаунтов и без сети')}
      >
        <ul className="profilelist">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId
            return (
              <li
                key={profile.id}
                className={`profilelist__row${isActive ? ' profilelist__row--active' : ''}`}
              >
                <span className="profilelist__avatar" aria-hidden="true">
                  {initials(profile.name)}
                </span>
                <span className="profilelist__main">
                  <span className="profilelist__name">{profile.name}</span>
                  <span className="profilelist__meta">
                    {isActive ? t('Активный профиль') : t('Создан {0}', { 0: createdLabel(profile.createdAt) })}
                  </span>
                </span>

                {isActive ? (
                  <span className="badge badge--accent">{t('активен')}</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void switchProfile(profile.id)}
                  >{t('Переключить')}</button>
                )}

                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title={t('Переименовать')}
                  onClick={() => setRenaming(profile)}
                >
                  <Icon name="pencil" size={15} />
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title={profiles.length <= 1 ? t('Нельзя удалить единственный профиль') : t('Удалить профиль')}
                  disabled={profiles.length <= 1}
                  onClick={() => setRemoving(profile)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="field__row">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />
            {t('Новый профиль')}</button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!appInfo?.userData}
            onClick={() => appInfo?.userData && void api.local.reveal(appInfo.userData)}
          >
            <Icon name="folder" size={15} />
            {t('Открыть папку профиля')}</button>
        </div>

        <p className="page__note">{t('Каждый профиль хранит свою библиотеку, плейлисты, избранное, тексты, обложки и загрузки — целиком в отдельной папке. Вход и пароль не нужны: профили живут только на этом компьютере.')}</p>
      </SectionCard>

      <PromptModal
        open={creating}
        title={t('Новый профиль')}
        label={t('Название профиля')}
        placeholder={t('Например, Рабочая музыка')}
        confirmLabel={t('Создать')}
        onCancel={() => setCreating(false)}
        onConfirm={(value) => {
          setCreating(false)
          void createProfile(value)
        }}
      />

      <PromptModal
        open={renaming !== null}
        title={t('Переименовать профиль')}
        label={t('Название профиля')}
        initialValue={renaming?.name ?? ''}
        confirmLabel={t('Сохранить')}
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          const target = renaming
          setRenaming(null)
          if (target) void renameProfile(target.id, value)
        }}
      />

      <ConfirmModal
        open={removing !== null}
        title={t('Удалить профиль?')}
        confirmLabel={t('Удалить навсегда')}
        text={
          <>{t('Профиль «{0}» и вся его библиотека будут удалены с диска. Это действие нельзя отменить. {1}', { 0: removing?.name, 1: removing?.id === activeProfileId ? t(' Вы будете переключены на другой профиль.') : '' })}</>
        }
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (target) void deleteProfile(target.id)
        }}
      />

      {active && profiles.length > 1 ? (
        <p className="page__note">{t('Сейчас используется профиль «{0}».', { 0: active.name })}</p>
      ) : null}
    </>
  )
}
