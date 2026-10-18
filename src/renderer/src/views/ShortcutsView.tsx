/** Keyboard reference. Kept in sync with `useKeyboardShortcuts` and the app menu. */

import type { JSX } from 'react'
import { Page, PageHeader } from '../components/Page'
import { Icon } from '../components/Icon'
import { SectionCard } from '../components/Controls'

interface Shortcut {
  keys: string[]
  label: string
}

const GROUPS: { title: string; icon: 'play' | 'compass' | 'folder'; items: Shortcut[] }[] = [
  {
    title: 'Воспроизведение',
    icon: 'play',
    items: [
      { keys: ['Пробел'], label: 'Воспроизвести / пауза' },
      { keys: ['N'], label: 'Следующий трек' },
      { keys: ['P'], label: 'Предыдущий трек (или в начало)' },
      { keys: ['→'], label: 'Вперёд на 5 секунд (Shift — 30 секунд)' },
      { keys: ['←'], label: 'Назад на 5 секунд (Shift — 30 секунд)' },
      { keys: ['↑'], label: 'Громче' },
      { keys: ['↓'], label: 'Тише' },
      { keys: ['M'], label: 'Выключить / включить звук' },
      { keys: ['S'], label: 'Случайный порядок' },
      { keys: ['R'], label: 'Режим повтора' },
      { keys: ['F'], label: 'Добавить в избранное' }
    ]
  },
  {
    title: 'Интерфейс',
    icon: 'compass',
    items: [
      { keys: ['L'], label: 'Панель текста песни' },
      { keys: ['Q'], label: 'Панель очереди' },
      { keys: ['/'], label: 'Перейти к поиску' },
      { keys: ['Esc'], label: 'Закрыть окно воспроизведения или диалог' },
      { keys: ['Двойной клик'], label: 'Воспроизвести трек в списке' }
    ]
  },
  {
    title: 'Меню приложения',
    icon: 'folder',
    items: [
      { keys: ['Ctrl', 'O'], label: 'Импортировать файлы' },
      { keys: ['Ctrl', 'Shift', 'O'], label: 'Импортировать папку' },
      { keys: ['Ctrl', 'N'], label: 'Новый плейлист' },
      { keys: ['Ctrl', 'F'], label: 'Поиск' },
      { keys: ['Ctrl', 'Shift', 'L'], label: 'Найти текст песни' },
      { keys: ['Ctrl', '1…5'], label: 'Обзор, библиотека, плейлисты, избранное, загрузки' },
      { keys: ['Ctrl', ','], label: 'Настройки' },
      { keys: ['F12'], label: 'Инструменты разработчика' }
    ]
  }
]

export function ShortcutsView(): JSX.Element {
  return (
    <Page className="page--shortcuts">
      <PageHeader
        icon="bolt"
        title="Клавиатурные сокращения"
        subtitle="Работают везде, кроме полей ввода и открытых диалогов"
      />

      {GROUPS.map((group) => (
        <SectionCard key={group.title} icon={group.icon} title={group.title}>
          <ul className="shortcuts">
            {group.items.map((item) => (
              <li className="shortcuts__row" key={item.label}>
                <span className="shortcuts__keys">
                  {item.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
                <span className="shortcuts__label">{item.label}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}

      <p className="page__note">
        <Icon name="info" size={14} /> Медиа-клавиши клавиатуры и системные элементы управления
        воспроизведением (Windows) поддерживаются автоматически.
      </p>
    </Page>
  )
}
