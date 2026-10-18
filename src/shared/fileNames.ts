/**
 * Names taken back out of file names.
 *
 * Windows forbids nine characters in a file name — `\ / : * ? " < > |` — and
 * music services quietly swap each of them for an underscore when they write a
 * track to disk. So "Ты кто?" is stored as `Ты кто_.flac`, and "AC/DC" becomes
 * `AC_DC`. Reading the name back verbatim leaves a library full of stray
 * underscores, so this module guesses what the underscore used to be.
 *
 * Only the three patterns that occur in real titles are restored, and only when
 * the guess is well supported:
 *
 * | in the file name      | restored | example                          |
 * | --------------------- | -------- | -------------------------------- |
 * | `_` at the very end   | `?`      | `Что ты знаешь_` → `Что ты знаешь?` |
 * | `_` before a space    | `:`      | `Часть 1_ Начало` → `Часть 1: Начало` |
 * | `_` between letters   | `/`      | `AC_DC` → `AC/DC`                |
 *
 * A bracketed qualifier after the space is the one exception to the second rule:
 * `Кто это_ (версия 2)` is a question with a note, not a subtitle.
 *
 * Everything else — a leading underscore, a run of two or more (`hate music ^__`,
 * a kaomoji), an underscore between spaces — is left exactly as it is. A wrong
 * guess is worse than a visible underscore, so anything unclear is untouched.
 *
 * Kept free of Node and DOM so both processes can use it and a unit test can
 * compile it on its own (`npm run test:names`).
 */

const CLOSING = new Set([')', ']', '}', ',', '.', '!', '…', '»', '"', '\u201d', '\u2019'])

function isWordCharacter(value: string | undefined): boolean {
  if (!value) return false
  return /[\p{L}\p{N}]/u.test(value)
}

/**
 * Restores the characters Windows makes music services substitute. Names
 * without an underscore — and underscores that cannot be explained by a
 * forbidden character — come back unchanged.
 */
export function restoreForbiddenCharacters(value: string): string {
  if (!value.includes('_')) return value

  const char = [...value]
  let out = ''

  for (let index = 0; index < char.length; index++) {
    if (char[index] !== '_') {
      out += char[index]
      continue
    }

    // A run of underscores is deliberate far more often than it is a run of
    // forbidden characters, so leave the whole run alone.
    if (char[index - 1] === '_' || char[index + 1] === '_') {
      out += '_'
      continue
    }

    const previous = char[index - 1]
    const next = char[index + 1]

    if (next === undefined) {
      // "Что ты знаешь_" — the name ended in a question mark.
      out += '?'
      continue
    }

    if (next === ' ' && previous !== ' ' && previous !== undefined) {
      // "Часть 1_ Начало" — a colon, which is always followed by a space. A
      // bracketed qualifier after that space is a note on a question instead:
      // "Кто это_ (версия 2)" is "Кто это? (версия 2)".
      const rest = char.slice(index + 2).join('')
      out += rest.startsWith('(') || rest.startsWith('[') ? '?' : ':'
      continue
    }

    if (isWordCharacter(previous) && isWordCharacter(next)) {
      // "AC_DC" — a slash, written without surrounding spaces.
      out += '/'
      continue
    }

    if (CLOSING.has(next)) {
      // "(Кто это_)" — the question mark closes the bracket group.
      out += '?'
      continue
    }

    out += '_'
  }

  return out
}
