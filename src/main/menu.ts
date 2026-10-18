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
        { role: 'about', label: 'О Kolaars Music' },
        { type: 'separator' },
        { role: 'services', label: 'Службы' },
        { type: 'separator' },
        { role: 'hide', label: 'Скрыть' },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        { type: 'separator' },
        { role: 'quit', label: 'Завершить' }
      ]
    })
  }

  template.push(
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Импортировать файлы…',
          accelerator: 'CmdOrCtrl+O',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'import-files')
        },
        {
          label: 'Импортировать папку…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'import-folder')
        },
        {
          label: 'Импортировать список треков…',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'import-list')
        },
        { type: 'separator' },
        {
          label: 'Новый плейлист',
          accelerator: 'CmdOrCtrl+N',
          click: () => getWindow()?.webContents.send(EV.mediaCommand, 'new-playlist')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Закрыть окно' } : { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
        { type: 'separator' },
        {
          label: 'Найти текст песни',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: command('find-lyrics')
        }
      ]
    },
    {
      label: 'Воспроизведение',
      submenu: [
        { label: 'Воспроизвести / Пауза', click: command('play-pause') },
        { label: 'Следующий трек', click: command('next') },
        { label: 'Предыдущий трек', click: command('previous') },
        { label: 'Остановить', click: command('stop') },
        { type: 'separator' },
        { label: 'Случайный порядок', click: command('shuffle') },
        { label: 'Режим повтора', click: command('repeat') },
        { type: 'separator' },
        { label: 'Громче', click: command('volume-up') },
        { label: 'Тише', click: command('volume-down') },
        { label: 'Выключить звук', click: command('mute') },
        { type: 'separator' },
        { label: 'Показать текст песни', click: command('toggle-lyrics') },
        { label: 'Показать очередь', click: command('toggle-queue') }
      ]
    },
    {
      label: 'Навигация',
      submenu: [
        { label: 'Обзор', accelerator: 'CmdOrCtrl+1', click: navigate('discover') },
        { label: 'Поиск', accelerator: 'CmdOrCtrl+F', click: navigate('search') },
        { label: 'Библиотека', accelerator: 'CmdOrCtrl+2', click: navigate('library') },
        { label: 'Плейлисты', accelerator: 'CmdOrCtrl+3', click: navigate('playlists') },
        { label: 'Избранное', accelerator: 'CmdOrCtrl+4', click: navigate('favorites') },
        { label: 'Загрузки', accelerator: 'CmdOrCtrl+5', click: navigate('downloads') },
        { type: 'separator' },
        { label: 'Настройки', accelerator: 'CmdOrCtrl+,', click: navigate('settings') }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'forceReload', label: 'Обновить без кэша' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Исходный масштаб' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полноэкранный режим' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'Клавиатурные сокращения',
          click: navigate('shortcuts')
        },
        { type: 'separator' },
        {
          label: 'Исходный код на GitHub',
          click: () => void shell.openExternal(REPO_URL)
        },
        {
          label: 'Internet Archive — источник музыки',
          click: () => void shell.openExternal('https://archive.org/details/georgeblood')
        },
        {
          label: 'Лицензия и правовая информация',
          click: navigate('about')
        },
        { type: 'separator' },
        {
          label: isMac ? 'O Kolaars Music' : 'О программе',
          click: () => getWindow()?.webContents.send(EV.navigate, 'about')
        }
      ]
    }
  )

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
