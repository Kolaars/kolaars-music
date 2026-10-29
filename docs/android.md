# Android

Порт Kolaars Music на Android. Электрон не работает на Android, поэтому приложение
собирается как **Capacitor 8**: существующий React-интерфейс живёт в WebView, а
платформенный слой заменяет Electron IPC на нативные вызовы Android.

## Схема

```
renderer (React 19 + zustand)          — без изменений
        │
        ▼
window.kolaars                          — один и тот же контракт KolaarsApi
        │
        ├── desktop: preload → ipcMain → main (как сейчас)
        └── android: src/platform/android → Capacitor + Kotlin
```

Ключевое правило: экраны, состояние и стили не знают, где они запущены. Вся
разница спрятана за `src/renderer/src/lib/api.ts`. На десктопе мост приходит из
preload, на Android — из `createAndroidApi()`.

## Что переносится без изменений

- `src/shared/*` — типы, LRC, разбор списков, имена файлов, Discord-presence.
- `src/renderer/src/views`, `components`, `state`, `hooks`.
- `data/seed-catalog.json` и `data/lyrics-pack.json` — включаются в бандл.

## Что заменяется нативным слоем

| Десктоп | Android |
| --- | --- |
| `kolaars.json` в `userData` | JSON в приватном каталоге приложения (`Filesystem`) |
| `kmedia://` + `file://` | `content://` через SAF, `Capacitor.convertFileSrc` |
| `music-metadata` | `MediaMetadataRetriever` в Kotlin-плагине |
| `fs` + `downloads.ts` | `DownloadManager` / OkHttp в каталог приложения |
| `safeStorage` | Android Keystore |
| `<audio>` в WebView | Media3 ExoPlayer + foreground service (фон) |
| Discord RPC | отсутствует, настройка скрыта |
| `fetch` в main | `CapacitorHttp` (обход CORS) |

## Нативные модули

1. **SAF-плагин.** `ACTION_OPEN_DOCUMENT_TREE` и `ACTION_OPEN_DOCUMENT`, затем
   `takePersistableUriPermission`. Отдаёт список `content://`-URI и метаданные.
2. **Метаданные.** `MediaMetadataRetriever` для исполнителя, названия, альбома,
   длительности и встроенной обложки. Обложка сохраняется в кэш приложения.
3. **Плеер.** На первом этапе — `<audio>` в WebView по `convertFileSrc`; на
   втором — Media3 с foreground service, медиа-уведомлением и управлением с
   экрана блокировки. Интерфейс получает те же события, что и сейчас.
4. **Секреты.** Ключи YouTube/SoundCloud — `EncryptedSharedPreferences` поверх
   Android Keystore, а не открытый JSON.
5. **Загрузки.** Прямые файлы Internet Archive скачиваются в приватный каталог;
   `DownloadManager` переживает сворачивание приложения.

## Ограничения

- **Discord Rich Presence** на Android не поддерживается; переключатель скрыт.
- **YouTube IFrame** требует сеть и origin. Capacitor отдаёт страницу с
  `http://localhost`, поэтому официальный плеер работает; невстраиваемые видео
  обрабатываются той же проверкой `status.embeddable`.
- **Локальные файлы** доступны только через SAF. Пути `C:\...` из десктопного
  профиля на Android не переносятся; библиотеку нужно импортировать заново.
- **Формат профиля** совместим, но `kmedia://`-ссылки при импорте заменяются на
  `content://`, поэтому перенос каталога профиля с Windows не даст рабочие треки.

## Этапы

### Этап 0 — каркас и онлайн-каталог

- Capacitor-проект, `vite.mobile.config.ts`, `android/`.
- `KolaarsApi` вынесен в `src/shared/api.ts`; `createAndroidApi()`.
- Обзор, поиск по Internet Archive, album view, воспроизведение https-потоков.
- Библиотека, избранное, плейлисты, настройки и тексты — в JSON-хранилище.
- Сборка debug APK и запуск на устройстве.

### Этап 1 — локальная музыка

- SAF-плагин, импорт папки и файлов, метаданные, обложки, `.lrc` рядом.
- Играй всё, очередь, повтор, перемешивание для локальных треков.
- Импорт списков треков и экспорт плейлистов через SAF.

### Этап 2 — фон и загрузки

- Media3 foreground service, уведомление, экран блокировки, наушники.
- Офлайн-загрузки Internet Archive, прогресс, отмена, удаление.
- Профили, ключи источников в Keystore, YouTube Music и SoundCloud.

### Этап 3 — выпуск

- Мобильная вёрстка: нижняя навигация, safe-area, крупные элементы.
- Подпись release APK/AAB, версии, changelog, GitHub Release.
- Тесты на устройстве, скриншоты, документация.

## Сборка

Инструменты ставятся на `E:\Android`, чтобы не занимать диск `C:`:

```
E:\Android\jdk21\...        JDK 21 (Temurin 21.0.12.1) — установлен
E:\Android\sdk\...          Android SDK: platform-tools 37, android-36, build-tools 36.0.0
E:\Android\gradle\...       Gradle caches
```

Переменные окружения для сборки (PowerShell):

```powershell
$env:JAVA_HOME = 'E:\Android\jdk21'
$env:ANDROID_HOME = 'E:\Android\sdk'
$env:ANDROID_SDK_ROOT = 'E:\Android\sdk'
$env:GRADLE_USER_HOME = 'E:\Android\gradle'
```

Команды:

```
npm run mobile:build     # web-бандл для WebView (out/mobile)
npm run mobile:sync      # копирование в android/
npm run mobile:apk       # gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

MIUI не даёт ставить APK по `adb install` (`INSTALL_FAILED_USER_RESTRICTED`),
поэтому сборку кладём в «Загрузки» и устанавливаем вручную:

```
adb push android/app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/KolaarsMusic-1.3.2.apk
```

Отладка идёт по Wi-Fi, чтобы обрыв кабеля не рвал сессию. Один раз после
перезагрузки телефона нужен USB — скрипт сам переведёт adb в сетевой режим,
подключится и покажет установленную версию:

```
powershell -ExecutionPolicy Bypass -File scripts/android-wifi.ps1
```

Страница WebView инспектируется через Chrome DevTools Protocol, без эмулятора:

```
powershell -ExecutionPolicy Bypass -File scripts/android-eval.ps1 -Expression "document.title"
powershell -ExecutionPolicy Bypass -File scripts/android-logs.ps1 -Seconds 15
powershell -ExecutionPolicy Bypass -File scripts/android-logs.ps1 -Seconds 20 -Reload
```

Если экран телефона погас, WebView душит таймеры и `await`-выражения в
`android-eval.ps1` зависают — тестировать нужно с включённым экраном.

`npm run mobile:build` собирает `src/renderer/index.mobile.html` через
`vite.mobile.config.ts` и переименовывает результат в `index.html`, который
ожидает Capacitor. Десктопный `index.html` при этом не трогается.

Сеть на этой машине рвёт TLS-рукопожатия Maven Central при большом числе
параллельных соединений, поэтому в `android/gradle.properties` включены IPv4,
увеличенные таймауты и сборка идёт с `--max-workers=2`.

Иконки и сплэши пересобираются из `resources/icon.png`:

```
powershell -ExecutionPolicy Bypass -File scripts/build-android-assets.ps1
```

## Состояние этапа 0

- [x] Capacitor-проект, `capacitor.config.ts`, `vite.mobile.config.ts`, `android/`.
- [x] `KolaarsApi` вынесен в `src/shared/api.ts`; десктопный preload типизирован им.
- [x] `createAndroidApi()`: JSON-хранилище, профили, каталог, поиск и воспроизведение
      Internet Archive, тексты LRCLIB / Wikisource / встроенный сборник, плейлисты,
      избранное, история, импорт списков треков.
- [x] Нативный HTTP через `CapacitorHttp` (без CORS).
- [x] Аппаратная кнопка «Назад»: сначала закрывает диалоги и панель «Сейчас играет»,
      затем шаг назад по маршрутам, и только потом сворачивает приложение.
- [x] Мобильный слой CSS: скрыты кнопки окна, навигация — горизонтальная лента,
      плеер перестраивается в две строки, учтён safe-area.
- [x] Иконки и сплэши Android из `resources/icon.png`.
- [x] В навигации Android скрыты «Сокращения», «Загрузки» и «Источники»: две
      последние появятся на этапах 1–2, клавиатуры на телефоне нет.
- [x] Сборка debug APK и первый запуск на устройстве (Redmi 9, Android 10).
- [ ] Этап 1: SAF, локальные файлы, `.lrc` рядом, экспорт плейлистов.
- [ ] Этап 2: Media3 + foreground service, офлайн-загрузки, ключи источников.
- [ ] Этап 3: полировка вёрстки, подпись release, публикация.

Заглушки этапа 0 честно сообщают об отсутствии функции: импорт локальных файлов,
офлайн-загрузки, ключи YouTube/SoundCloud, экспорт плейлистов и `.lrc`. Discord
Rich Presence на Android отключён полностью.

## Проверка на устройстве

1. На телефоне: «Для разработчиков» → «Отладка по USB».
2. Подключить USB, выбрать режим «Передача файлов», разрешить отладку.
3. `adb devices` должен показать устройство.
4. Установить APK, запустить, снять `adb logcat` при падении:

```
E:\Android\sdk\platform-tools\adb.exe logcat -d -s Capacitor/Console:V chromium:V AndroidRuntime:E
```

Эмулятор не обязателен: первый APK проверяем на реальном устройстве.
