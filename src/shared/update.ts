/**
 * Version comparison for the built-in updater.
 *
 * The app releases tags like `v1.3.4`, while `app.getVersion()` returns
 * `1.3.4`; both spellings have to compare correctly. The implementation
 * follows Semantic Versioning closely enough for release tags (numeric core,
 * optional pre-release identifiers) without pulling `semver` into the
 * renderer or the mobile bundle.
 */

interface ParsedVersion {
  core: number[]
  prerelease: string[]
}

/** Drops a leading `v` and surrounding whitespace from a release tag. */
export function normalizeVersion(input: string): string {
  return String(input ?? '')
    .trim()
    .replace(/^v/i, '')
}

function parseVersion(input: string): ParsedVersion | null {
  const value = normalizeVersion(input).split('+', 1)[0]
  if (!value) return null

  const dash = value.indexOf('-')
  const corePart = dash === -1 ? value : value.slice(0, dash)
  const prereleasePart = dash === -1 ? '' : value.slice(dash + 1)
  const parts = corePart.split('.')
  if (parts.length === 0 || parts.length > 3) return null

  const core: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    core.push(Number(part))
  }
  while (core.length < 3) core.push(0)

  return {
    core,
    prerelease: prereleasePart ? prereleasePart.split('.') : []
  }
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    return Math.sign(Number(left) - Number(right))
  }
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compares two versions.
 *
 * Returns a negative number when `left` is older, zero when the versions are
 * equivalent, and a positive number when `left` is newer. Invalid versions
 * compare as older than any valid one.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1

  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index] - b.core[index]
    if (difference !== 0) return Math.sign(difference)
  }

  // A release outranks any pre-release of the same core version.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const difference = compareIdentifiers(leftPart, rightPart)
    if (difference !== 0) return difference
  }
  return 0
}

/** True when `candidate` is a release the current build should offer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/** Public release page for a version tag. */
export function releasePageUrl(version: string): string {
  return `https://github.com/Kolaars/kolaars-music/releases/tag/v${normalizeVersion(version)}`
}
