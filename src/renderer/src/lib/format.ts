/** Formatting helpers used across the UI. */

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatRelativeDate(timestamp: number | null | undefined): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return 'только что'
  if (diff < hour) return plural(Math.floor(diff / minute), 'минуту', 'минуты', 'минут') + ' назад'
  if (diff < day) return plural(Math.floor(diff / hour), 'час', 'часа', 'часов') + ' назад'
  if (diff < 30 * day) return plural(Math.floor(diff / day), 'день', 'дня', 'дней') + ' назад'
  return new Date(timestamp).toLocaleDateString('ru-RU')
}

/** Russian plural form selection: plural(3, 'трек', 'трека', 'треков'). */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return `${count} ${many}`
  if (last > 1 && last < 5) return `${count} ${few}`
  if (last === 1) return `${count} ${one}`
  return `${count} ${many}`
}

export function trackCountLabel(count: number): string {
  return plural(count, 'трек', 'трека', 'треков')
}

/** A short, human label for where a track came from. */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'local':
      return 'Локальный файл'
    case 'online':
      return 'Internet Archive'
    case 'seed':
      return 'Каталог Kolaars'
    default:
      return source
  }
}
