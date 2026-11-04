/**
 * Application menu.
 *
 * Accelerators are deliberately limited to combinations that cannot collide
 * with typing in a text field. Playback control lives on the renderer side
 * (see `useKeyboardShortcuts`) plus the OS media keys through MediaSession, so
 * the menu stays a discoverability surface rather than a keybinding registry.
 */

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { EV, type MediaCommand } from '@shared/ipc'
import { t } from '@shared/i18n'

const REPO_URL = 'https://github.com/Kolaars/kolaars-music'

export function buildAppMenu(getWindow: () => BrowserWindow | null): void {
  const command = (name: MediaCommand): (() => void) => () => {
    getWindow()?.webContents.send(EV.mediaCommand, name)
  }
  const navigate = (route: string): (() => void) => () => {
    const win = getWindow()
    if (!win) return
    win.show()
    win.focus()
    win.webContents.send(EV.navigate, route)
  }

  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: t('О Kolaars Music') },
        { type: 'separator' },
        { role: 'services', label: t('Службы') },
        { type: 'separator' },
        { role: 'hide', label: t('Скрыть') },
        { role: 'hideOthers', label: t('Скрыть остальные') },
        { role: 'unhide', label: t('Показать все') },
        { type: 'separator' },
        { role: 'quit', label: t('Завершить') }
      ]
    })
  }

  template.push(
    {
      label: t('Файл'),
      submenu: [
        {
          label: t('Импортировать файлы…'),
          accelerator: 'CmdOrCtrl+O',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'import-files')
        },
        {
          label: t('Импортировать папку…'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'import-folder')
        },
        {
          label: t('Импортировать список треков…'),
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'import-list')
        },
        { type: 'separator' },
        {
          label: t('Новый плейлист'),
          accelerator: 'CmdOrCtrl+N',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'new-playlist')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: t('Закрыть окно') } : { role: 'quit', label: t('Выход') }
      ]
    },
    {
      label: t('Правка'),
      submenu: [
        { role: 'undo', label: t('Отменить действие') },
        { role: 'redo', label: t('Повторить действие') },
        { type: 'separator' },
        { role: 'cut', label: t('Вырезать') },
        { role: 'copy', label: t('Копировать') },
        { role: 'paste', label: t('Вставить') },
        { role: 'selectAll', label: t('Выделить всё') },
        { type: 'separator' },
        {
          label: t('Найти текст песни'),
          accelerator: 'CmdOrCtrl+Shift+L',
          click: command('find-lyrics')
        }
      ]
    },
    {
      label: t('Воспроизведение'),
      submenu: [
        { label: t('Воспроизвести / Пауза'), click: command('play-pause') },
        { label: t('Следующий трек'), click: command('next') },
        { label: t('Предыдущий трек'), click: command('previous') },
        { label: t('Остановить'), click: command('stop') },
        { type: 'separator' },
        { label: t('Случайный порядок'), click: command('shuffle') },
        { label: t('Режим повтора'), click: command('repeat') },
        { type: 'separator' },
        { label: t('Громче'), click: command('volume-up') },
        { label: t('Тише'), click: command('volume-down') },
        { label: t('Выключить звук'), click: command('mute') },
        { type: 'separator' },
        { label: t('Показать текст песни'), click: command('toggle-lyrics') },
        { label: t('Показать очередь'), click: command('toggle-queue') }
      ]
    },
    {
      label: t('Навигация'),
      submenu: [
        { label: t('Обзор'), accelerator: 'CmdOrCtrl+1', click: navigate('discover') },
        { label: t('Поиск'), accelerator: 'CmdOrCtrl+F', click: navigate('search') },
        { label: t('Библиотека'), accelerator: 'CmdOrCtrl+2', click: navigate('library') },
        { label: t('Плейлисты'), accelerator: 'CmdOrCtrl+3', click: navigate('playlists') },
        { label: t('Избранное'), accelerator: 'CmdOrCtrl+4', click: navigate('favorites') },
        { label: t('Загрузки'), accelerator: 'CmdOrCtrl+5', click: navigate('downloads') },
        { label: t('Источники'), accelerator: 'CmdOrCtrl+6', click: navigate('sources') },
        { type: 'separator' },
        { label: t('Настройки'), accelerator: 'CmdOrCtrl+,', click: navigate('settings') }
      ]
    },
    {
      label: t('Вид'),
      submenu: [
        { role: 'reload', label: t('Обновить') },
        { role: 'forceReload', label: t('Обновить без кэша') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('Исходный масштаб') },
        { role: 'zoomIn', label: t('Увеличить') },
        { role: 'zoomOut', label: t('Уменьшить') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Полноэкранный режим') },
        { type: 'separator' },
        { role: 'toggleDevTools', label: t('Инструменты разработчика') }
      ]
    },
    {
      label: t('Справка'),
      submenu: [
        {
          label: t('Клавиатурные сокращения'),
          click: navigate('shortcuts')
        },
        { type: 'separator' },
        {
          label: t('Исходный код на GitHub'),
          click: () => void shell.openExternal(REPO_URL)
        },
        {
          label: t('Internet Archive — источник музыки'),
          click: () => void shell.openExternal('https://archive.org/details/georgeblood')
        },
        {
          label: t('Лицензия и правовая информация'),
          click: navigate('about')
        },
        { type: 'separator' },
        {
          label: isMac ? t('О Kolaars Music') : t('О программе'),
          click: () => getWindow()?.webContents.send(EV.navigate, 'about')
        }
      ]
    }
  )

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
