/** Formatting helpers used across the UI. */

import { getLocale, localeTag, t } from './i18n'

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
  const units = [t('Б'), t('КБ'), t('МБ'), t('ГБ')]
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

  if (diff < minute) return t('только что')
  const relative = new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto' })
  if (diff < hour) return relative.format(-Math.floor(diff / minute), 'minute')
  if (diff < day) return relative.format(-Math.floor(diff / hour), 'hour')
  if (diff < 30 * day) return relative.format(-Math.floor(diff / day), 'day')
  return new Date(timestamp).toLocaleDateString(localeTag())
}

/**
 * Plural form selection.
 *
 * Russian needs three forms (`plural(3, 'трек', 'трека', 'треков')`); English
 * only distinguishes singular from plural, so the `many` form is used for
 * everything except one.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  if (getLocale() === 'en') return `${count} ${count === 1 ? one : many}`
  const abs = Math.abs(count) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return `${count} ${many}`
  if (last > 1 && last < 5) return `${count} ${few}`
  if (last === 1) return `${count} ${one}`
  return `${count} ${many}`
}

export function trackCountLabel(count: number): string {
  return plural(count, t('трек'), t('трека'), t('треков'))
}

/** A short, human label for where a track came from. */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'local':
      return t('Локальный файл')
    case 'online':
      return 'Internet Archive'
    case 'seed':
      return t('Каталог Kolaars')
    default:
      return source
  }
}
