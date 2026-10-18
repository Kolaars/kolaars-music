/** Settings — theme, playback, sources and local data. */

import { useState, type JSX } from 'react'
import type { Profile, ThemeMode } from '@shared/types'
import { api } from '../lib/api'
import { useApp } from '../state/store'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { Field, Range, SectionCard, Select, Switch } from '../components/Controls'
import { ConfirmModal, PromptModal } from '../components/Dialogs'

const ACCENTS = ['#7c5cff', '#4f8cff', '#22c1a4', '#f4b740', '#ff6b6b', '#ff5ea8', '#8ce563', '#00b8d9']

export function SettingsView(): JSX.Element {
  const settings = useApp((state) => state.settings)
  const appInfo = useApp((state) => state.appInfo)
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
        title="Настройки"
        subtitle="Всё хранится локально, в одном файле kolaars.json в папке данных приложения"
      />

      <ProfilesCard />

      <SectionCard icon="sparkles" title="Внешний вид" description="Тема оформления и акцентный цвет">
        <Field label="Тема" hint="Тёмная, светлая или как в системе">
          <Select<ThemeMode>
            label="Тема"
            value={settings.theme}
            onChange={(value) => void updateSettings({ theme: value })}
            options={[
              { value: 'dark', label: 'Тёмная' },
              { value: 'light', label: 'Светлая' },
              { value: 'system', label: 'Как в системе' }
            ]}
          />
        </Field>

        <Field label="Акцентный цвет" hint="Используется для кнопок, ползунков и активных элементов">
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
            <label className="swatch swatch--custom" title="Свой цвет">
              <Icon name="pencil" size={13} />
              <input
                type="color"
                value={settings.accent}
                onChange={(event) => void updateSettings({ accent: event.target.value })}
              />
            </label>
          </div>
        </Field>
      </SectionCard>

      <SectionCard icon="equalizer" title="Воспроизведение" description="Громкость, переходы и уведомления">
        <Field label="Громкость по умолчанию" hint="Дополнительная коррекция громкости для всех треков">
          <Range
            label="Коррекция громкости"
            min={-12}
            max={12}
            step={1}
            value={settings.volumeTrim}
            onChange={(value) => void updateSettings({ volumeTrim: value })}
            format={(value) => `${value > 0 ? '+' : ''}${value} дБ`}
          />
        </Field>

        <Field label="Плавный переход" hint="Кроссфейд между треками, в секундах (0 — выключен)">
          <Range
            label="Кроссфейд"
            min={0}
            max={8}
            step={0.5}
            value={settings.crossfade}
            onChange={(value) => void updateSettings({ crossfade: value })}
            format={(value) => (value === 0 ? 'выключен' : `${value} с`)}
          />
        </Field>

        <Field label="Нормализация громкости" hint="Выравнивает громкость между записями разных лет">
          <Switch
            label="Нормализация громкости"
            checked={settings.normalizeLoudness}
            onChange={(value) => void updateSettings({ normalizeLoudness: value })}
          />
        </Field>

        <Field label="Продолжать с места остановки" hint="Сохранять очередь, трек и позицию между запусками">
          <Switch
            label="Продолжать с места остановки"
            checked={settings.resumeSession}
            onChange={(value) => void updateSettings({ resumeSession: value })}
          />
        </Field>

        <Field label="Уведомления" hint="Показывать системное уведомление при смене трека">
          <Switch
            label="Уведомления"
            checked={settings.notifications}
            onChange={(value) => void updateSettings({ notifications: value })}
          />
        </Field>
      </SectionCard>

      <SectionCard
        icon="globe"
        title="Источники"
        description="Kolaars работает офлайн из встроенного каталога. Онлайн-источники включаются отдельно"
      >
        <Field label="Онлайн-источники" hint="Разрешить обращения к Internet Archive, LRCLIB и Wikisource">
          <Switch
            label="Онлайн-источники"
            checked={settings.onlineProviders}
            onChange={(value) => void updateSettings({ onlineProviders: value })}
          />
        </Field>

        <Field label="Internet Archive" hint="Поиск и подборки из коллекций архива">
          <Switch
            label="Internet Archive"
            checked={settings.providers.archive}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, archive: value } })}
          />
        </Field>

        <Field label="LRCLIB" hint="Открытая база текстов, в том числе синхронизированных">
          <Switch
            label="LRCLIB"
            checked={settings.providers.lrclib}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, lrclib: value } })}
          />
        </Field>

        <Field label="Wikisource" hint="Проверенные тексты в общественном достоянии">
          <Switch
            label="Wikisource"
            checked={settings.providers.wikisource}
            onChange={(value) => void updateSettings({ providers: { ...settings.providers, wikisource: value } })}
          />
        </Field>

        <Field label="Предпочитать lossless" hint="Если у записи есть FLAC/WAV, выбирать его вместо MP3">
          <Switch
            label="Предпочитать lossless"
            checked={settings.preferLossless}
            onChange={(value) => void updateSettings({ preferLossless: value })}
          />
        </Field>
      </SectionCard>

      <SectionCard icon="folder" title="Файлы" description="Где хранятся офлайн-копии">
        <Field label="Папка загрузок" hint="Пусто — используется папка данных приложения">
          <div className="field__row">
            <span className="field__path" title={settings.downloadDir || appInfo?.downloadsDir}>
              {settings.downloadDir || appInfo?.downloadsDir || 'по умолчанию'}
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void pickDownloadDir()}>
              <Icon name="folder" size={15} />
              Выбрать
            </button>
            {settings.downloadDir ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void updateSettings({ downloadDir: '' })}
              >
                Сбросить
              </button>
            ) : null}
          </div>
        </Field>

        <Field label="Папка данных" hint="Здесь лежит kolaars.json, обложки из тегов и загрузки по умолчанию">
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
              Открыть
            </button>
          </div>
        </Field>
      </SectionCard>

      <SectionCard icon="shield" title="Правовая информация" description="Лицензии, источники и благодарности">
        <Field label="Код приложения" hint="Kolaars Music распространяется под лицензией MIT">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRoute({ name: 'about' })}>
            <Icon name="info" size={15} />
            Открыть раздел «О программе»
          </button>
        </Field>
      </SectionCard>
    </Page>
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
        title="Профили"
        description="Несколько независимых библиотек на одном компьютере — без аккаунтов и без сети"
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
                    {isActive ? 'Активный профиль' : `Создан ${createdLabel(profile.createdAt)}`}
                  </span>
                </span>

                {isActive ? (
                  <span className="badge badge--accent">активен</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void switchProfile(profile.id)}
                  >
                    Переключить
                  </button>
                )}

                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title="Переименовать"
                  onClick={() => setRenaming(profile)}
                >
                  <Icon name="pencil" size={15} />
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--sm"
                  title={profiles.length <= 1 ? 'Нельзя удалить единственный профиль' : 'Удалить профиль'}
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
            Новый профиль
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!appInfo?.userData}
            onClick={() => appInfo?.userData && void api.local.reveal(appInfo.userData)}
          >
            <Icon name="folder" size={15} />
            Открыть папку профиля
          </button>
        </div>

        <p className="page__note">
          Каждый профиль хранит свою библиотеку, плейлисты, избранное, тексты, обложки и загрузки — целиком
          в отдельной папке. Вход и пароль не нужны: профили живут только на этом компьютере.
        </p>
      </SectionCard>

      <PromptModal
        open={creating}
        title="Новый профиль"
        label="Название профиля"
        placeholder="Например, Рабочая музыка"
        confirmLabel="Создать"
        onCancel={() => setCreating(false)}
        onConfirm={(value) => {
          setCreating(false)
          void createProfile(value)
        }}
      />

      <PromptModal
        open={renaming !== null}
        title="Переименовать профиль"
        label="Название профиля"
        initialValue={renaming?.name ?? ''}
        confirmLabel="Сохранить"
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          const target = renaming
          setRenaming(null)
          if (target) void renameProfile(target.id, value)
        }}
      />

      <ConfirmModal
        open={removing !== null}
        title="Удалить профиль?"
        confirmLabel="Удалить навсегда"
        text={
          <>
            Профиль «{removing?.name}» и вся его библиотека будут удалены с диска. Это действие нельзя
            отменить.
            {removing?.id === activeProfileId ? ' Вы будете переключены на другой профиль.' : ''}
          </>
        }
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (target) void deleteProfile(target.id)
        }}
      />

      {active && profiles.length > 1 ? (
        <p className="page__note">Сейчас используется профиль «{active.name}».</p>
      ) : null}
    </>
  )
}
