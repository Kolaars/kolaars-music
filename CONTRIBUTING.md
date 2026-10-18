# Как участвовать в проекте

Спасибо за интерес к Kolaars Music! Проект рад pull request'ам, сообщениям об ошибках и
новым данным — записям, подборкам и текстам.

## Прежде чем начать

- Пожалуйста, соблюдайте [Кодекс поведения](CODE_OF_CONDUCT.md).
- Для крупных изменений (новая архитектура, смена провайдера, массовая переработка
  интерфейса) сначала откройте issue и опишите замысел — так мы не потратим время зря.
- Мелкие исправления и тексты для сборника можно присылать сразу pull request'ом.

## Настройка окружения

```powershell
git clone https://github.com/Kolaars/kolaars-music.git
cd kolaars-music
npm install
npm run dev
```

Требуется Node.js ≥ 20.19.0 (проверено на 24.x). Если в PowerShell запрещены скрипты `.ps1`,
вызывайте npm через `& "C:\Program Files\nodejs\npm.cmd"`.

## Что должно проходить перед pull request'ом

```powershell
npm run typecheck   # типы для main/preload и renderer
npm run build       # production-сборка
npm run smoke       # сборка + автоматический тест интерфейса
```

Typecheck и smoke-тест обязательны: smoke ловит ошибки рендерера, которые не видны ни
сборке, ни проверке типов. Если вы меняли разметку, полезно заглянуть в сохранённые экраны:

```powershell
node scripts/smoke.mjs --screenshot=docs/screenshots --keep-open
```

## Стиль кода

- TypeScript везде; `strict` включён. Никаких `any` без веской причины.
- Отступ — два пробела, перевод строки — LF (см. `.editorconfig`).
- Точки с запятой не ставятся; строки — в одинарных кавычках (стиль всего проекта).
- Общие модули живут в `src/shared` и не должны зависеть ни от Node, ни от DOM.
- Тексты интерфейса — только на русском языке, без англоязычных вкраплений.
- Комментарии объясняют **почему**, а не «что»: код читается, а вот причины решений — нет.

## Архитектурные правила

- Любой новый сетевой доступ оформляется как провайдер в `src/main/providers/` и должен
  уважать настройку `onlineProviders` и флаги отдельных провайдеров.
- Обращения к сети выполняются только по явному действию пользователя либо для явно
  включённого провайдера — приложение не должно «звонить домой».
- Изменения состояния интерфейса идут через `zustand`-хранилища в `src/renderer/src/state`.
- Списки (плейлисты, избранное, сессия) хранят **идентификаторы**, а не копии треков;
  разрешение идентификаторов централизовано в `store.ts`.
- Новое IPC-сообщение сначала добавляется в `src/shared/ipc.ts`, затем в обработчик главного
  процесса и в мост `src/preload`.

## Данные и лицензии

Самая ценная помощь — новые записи и тексты. Правила простые:

- **Только свободные материалы.** Общественное достояние или Creative Commons. Никаких
  «серых» источников, рипов с пластинок вне открытых коллекций и текстов, защищённых
  авторским правом.
- Для музыки указывайте идентификатор Internet Archive, ссылку на первоисточник и лицензию.
- Для текстов в `data/lyrics-pack.json` — только произведения, опубликованные до 1931 года
  (общественное достояние США). Указывайте автора и год публикации.

Встроенный каталог пересобирается скриптом:

```powershell
node scripts/build-seed-catalog.mjs --per-shelf 24
```

Тексты правятся прямо в JSON. Подробности — в [docs/data.md](docs/data.md).

## Отчёты об ошибках

Полезный отчёт содержит:

1. версию Kolaars Music и Windows (видно на экране «О программе»);
2. шаги воспроизведения;
3. что ожидалось и что произошло;
4. запись из консоли разработчика (`F12` → Console), если есть.

Пожалуйста, не прикладывайте личные файлы и не публикуйте содержимое `kolaars.json` без
необходимости.

## Лицензия вкладов

Отправляя pull request, вы соглашаетесь, что ваш код распространяется под лицензией
[MIT](LICENSE), а добавленные тексты и данные — под условиями, указанными в
[docs/data.md](docs/data.md).

---

## Contributing (English)

Kolaars Music welcomes pull requests: bug fixes, UI work, new shelves and public-domain
lyrics. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first, open an issue for large
changes, and make sure `npm run typecheck` and `npm run smoke` pass before submitting. Follow
the project's code style (2 spaces, LF, no semicolons, single quotes), keep all user-facing
strings in Russian, and only contribute music and lyrics that are public domain or Creative
Commons. Code is contributed under the MIT licence.
