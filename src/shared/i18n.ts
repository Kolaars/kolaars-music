/**
 * Runtime localization shared by the renderer and the native menu.
 *
 * Russian source strings double as keys: the interface was written in Russian,
 * so a missing English translation degrades gracefully to readable text instead
 * of an identifier. Keys are normalised (entities decoded, whitespace
 * collapsed) before lookup, which lets JSX text and template strings use the
 * same entry.
 *
 * The current locale is module state because a few strings are produced
 * outside React (toasts in the store, file import reports, the menu). The
 * renderer remounts its shell when the language changes, so every component
 * reads the new value; the main process rebuilds the native menu.
 */

import { EN } from './i18n.en'

export type Locale = 'ru' | 'en'
export type LanguageSetting = Locale | 'system'

let current: Locale = 'ru'

/**
 * Picks the interface language stored in settings.
 *
 * `systemTag` lets callers outside the renderer supply the OS locale
 * (`app.getLocale()` in the main process); in a browser/Electron renderer the
 * navigator language is a good enough fallback.
 */
export function resolveLocale(
  setting: LanguageSetting | null | undefined,
  systemTag?: string | null
): Locale {
  if (setting === 'ru' || setting === 'en') return setting
  const tag =
    systemTag ||
    (typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().locale
        : 'ru')
  return tag.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export function setLocale(locale: Locale): void {
  current = locale
}

export function getLocale(): Locale {
  return current
}

/** BCP-47 tag for `toLocaleDateString` and friends. */
export function localeTag(): string {
  return current === 'ru' ? 'ru-RU' : 'en-US'
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  middot: '·'
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function normaliseKey(input: string): string {
  return decodeEntities(input).replace(/\s+/g, ' ').trim()
}

export function translate(key: string, vars?: Record<string, unknown>): string {
  const normalised = normaliseKey(key)
  const source = decodeEntities(key)
  const template = current === 'en' ? (EN[normalised] ?? source) : source
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined || value === null ? match : String(value)
  })
}

/**
 * English text for a Russian source string, regardless of the current locale.
 * Used where a provider returns a localised label that must be looked up later.
 */
export function english(key: string): string {
  const normalised = normaliseKey(key)
  return EN[normalised] ?? decodeEntities(key)
}

/** Number of English entries; the i18n unit check compares it with `t` keys. */
export const ENGLISH_ENTRY_COUNT = Object.keys(EN).length

export const t = translate
