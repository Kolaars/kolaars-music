/**
 * Renderer entry point for the shared localization engine.
 *
 * Keeping this module means existing imports (`../lib/i18n`) stay stable while
 * the dictionary and the locale state are shared with the main process, where
 * the native menu needs the same translations.
 */
export * from '../../../shared/i18n'
