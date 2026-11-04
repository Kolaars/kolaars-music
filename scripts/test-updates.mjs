#!/usr/bin/env node
/**
 * Unit checks for the updater's version comparison.
 *
 * A wrong comparison is either a missed update (the release is considered
 * older) or an endless update loop (the release is considered newer after it
 * was installed). Both are user-visible, so the parser is compiled on its own
 * and checked against the tag shapes the project actually publishes.
 *
 * Usage: npm run test:updates
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = path.join(root, 'src', 'shared', 'update.ts')

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('typescript is not installed — run `npm install` first')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'kolaars-update-'))
const compiled = spawnSync(
  process.execPath,
  [
    tsc,
    source,
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2022',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
    '--strict'
  ],
  { cwd: root, encoding: 'utf8' }
)

if (compiled.status !== 0) {
  console.error(compiled.stdout ?? '')
  console.error(compiled.stderr ?? '')
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

const require = createRequire(import.meta.url)
const { compareVersions, isNewerVersion, normalizeVersion, releasePageUrl } = require(
  path.join(outDir, 'update.js')
)

const checks = []
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  checks.push({ label, ok, actual, expected })
}

check('drops a v prefix', normalizeVersion('v1.3.4'), '1.3.4')
check('trims whitespace', normalizeVersion('  1.3.4  '), '1.3.4')

check('patch increase is newer', isNewerVersion('1.3.4', '1.3.3'), true)
check('same version is not newer', isNewerVersion('1.3.3', '1.3.3'), false)
check('older version is not newer', isNewerVersion('1.3.2', '1.3.3'), false)
check('numeric segments compare numerically', isNewerVersion('1.3.10', '1.3.9'), true)
check('two segments are padded', isNewerVersion('1.4', '1.3.99'), true)
check('v prefix works in comparison', isNewerVersion('v1.3.4', '1.3.3'), true)
check('prerelease is older than release', isNewerVersion('1.4.0', '1.4.0-beta.1'), true)
check('release is not older than prerelease', isNewerVersion('1.4.0-beta.1', '1.4.0'), false)
check('prerelease identifiers sort', isNewerVersion('1.4.0-beta.2', '1.4.0-beta.10'), false)
check('numeric prerelease sorts before text', isNewerVersion('1.4.0-alpha', '1.4.0-1'), true)
check('build metadata is ignored', isNewerVersion('1.3.4+build.9', '1.3.4'), false)
check('invalid candidate is not newer', isNewerVersion('not-a-version', '1.3.3'), false)
check('invalid current loses to a valid version', compareVersions('1.3.3', 'not-a-version') > 0, true)
check('equal versions compare as zero', compareVersions('1.3.3', 'v1.3.3'), 0)
check(
  'release page uses the tag',
  releasePageUrl('v1.3.4'),
  'https://github.com/Kolaars/kolaars-music/releases/tag/v1.3.4'
)

let failed = 0
for (const item of checks) {
  if (item.ok) {
    console.log(`  ok  ${item.label}`)
  } else {
    failed += 1
    console.error(` FAIL ${item.label}: got ${JSON.stringify(item.actual)}, expected ${JSON.stringify(item.expected)}`)
  }
}

rmSync(outDir, { recursive: true, force: true })
if (failed > 0) {
  console.error(`\n${failed} update check(s) failed`)
  process.exit(1)
}
console.log(`\nupdate checks passed: ${checks.length}`)
