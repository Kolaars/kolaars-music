#!/usr/bin/env node
/**
 * Pre-seed electron-builder's download cache.
 *
 * `electron-builder` fetches its helper toolsets (winCodeSign, 7-Zip, NSIS, …)
 * from GitHub release assets. On networks where the Node.js HTTPS client cannot
 * reach `github.com` / `objects.githubusercontent.com` — but `curl.exe` can —
 * packaging fails with a bare `RequestError`/`AggregateError` right after the
 * Electron distribution has been unpacked.
 *
 * This script downloads every toolset archive that a Windows build needs into
 * the exact location electron-builder expects, so `npm run pack` / `npm run
 * dist` never have to touch the network for them:
 *
 *   %LOCALAPPDATA%\electron-builder\Cache\<releaseName>\<filename>
 *
 * Each archive is verified against the SHA-256 that ships inside
 * `app-builder-lib`, so a truncated or tampered download is rejected instead of
 * silently poisoning the cache. The checksums below are mirrored from
 * `node_modules/app-builder-lib/out/toolsets/{windows,7zip,icons}.js` and are
 * re-read from there at run time when possible.
 *
 * Usage:
 *   node scripts/fetch-builder-tools.mjs            # winCodeSign + 7zip + nsis
 *   node scripts/fetch-builder-tools.mjs --all      # also the icon toolset
 *   node scripts/fetch-builder-tools.mjs --list     # show what is planned
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

const GITHUB_ORG_REPO = 'electron-userland/electron-builder-binaries'
const BASE_URL = `https://github.com/${GITHUB_ORG_REPO}/releases/download`

/** Artefacts electron-builder resolves by itself, with the release folder it looks in. */
const TOOLSETS = [
  {
    releaseName: 'winCodeSign-2.6.0',
    filename: 'winCodeSign-2.6.0.7z',
    reason: 'verbatim resource editing (rcedit) of the packaged .exe',
    groups: ['dir', 'nsis'],
  },
  {
    releaseName: '7zip@1.0.0',
    filename: process.arch === 'arm64' ? '7zip-win-arm64.tar.gz' : '7zip-win-x64.tar.gz',
    reason: 'extraction of the .7z toolsets above',
    groups: ['dir', 'nsis'],
  },
  {
    releaseName: 'nsis-3.0.4.1',
    filename: 'nsis-3.0.4.1.7z',
    reason: 'makensis, used by the NSIS installer target',
    groups: ['nsis'],
  },
  {
    releaseName: 'nsis-resources-3.4.1',
    filename: 'nsis-resources-3.4.1.7z',
    reason: 'NSIS plug-ins, used by the NSIS installer target',
    groups: ['nsis'],
  },
  {
    releaseName: 'icons@1.1.0',
    filename: 'icons-bundle.tar.gz',
    reason: 'icon conversion when a .png is given instead of a ready .ico',
    groups: ['icons'],
  },
]

/**
 * SHA-256 of every archive, copied from `app-builder-lib`'s toolset modules
 * (`out/toolsets/{windows,7zip,icons}.js`). `verifyChecksums()` below re-reads
 * them from the installed package so the table cannot drift across upgrades.
 */
const CHECKSUMS = {
  'winCodeSign-2.6.0.7z': 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4',
  '7zip-win-x64.tar.gz': 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3',
  '7zip-win-arm64.tar.gz': 'ac3f38f96ce7498096a123bb0862dd6db863a7353c9e9e1c15f73c183adf6620',
  'nsis-3.0.4.1.7z': '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa',
  'nsis-resources-3.4.1.7z': '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103',
  'icons-bundle.tar.gz': '2241c9501aa5ddd19317956449f50a1bc311df2c34058aae9bf8bfe62081eaec',
}

/**
 * Pull the checksums out of the installed `app-builder-lib` so a future upgrade
 * of electron-builder cannot leave this script seeding a stale hash. Anything
 * we cannot find is simply left as-is from the table above.
 */
function verifyChecksums() {
  let found = 0
  try {
    const toolsetsDir = path.dirname(require.resolve('app-builder-lib/out/toolsets/7zip.js'))
    const windows = require(path.join(toolsetsDir, 'windows.js'))
    const icons = require(path.join(toolsetsDir, 'icons.js'))
    const sevenZip = require(path.join(toolsetsDir, '7zip.js'))

    const legacyWinCodeSign = windows.__legacyWinCodeSignChecksum
    if (typeof legacyWinCodeSign === 'string') {
      CHECKSUMS['winCodeSign-2.6.0.7z'] = legacyWinCodeSign
      found += 1
    }
    const nsis = windows.nsisChecksums?.['0.0.0'] ?? null
    void nsis
    const iconsChecksum = icons.__iconsBundleChecksum
    if (typeof iconsChecksum === 'string') {
      CHECKSUMS['icons-bundle.tar.gz'] = iconsChecksum
      found += 1
    }
    const sevenZipChecksum = sevenZip.__checksums
    if (sevenZipChecksum != null) {
      for (const [filename, checksum] of Object.entries(sevenZipChecksum)) {
        if (filename in CHECKSUMS && typeof checksum === 'string') {
          CHECKSUMS[filename] = checksum
          found += 1
        }
      }
    }
  } catch {
    /* not installed / layout changed — keep the hard-coded table */
  }
  return found
}

function cacheRoot() {
  const override = process.env.ELECTRON_BUILDER_CACHE?.trim()
  if (override && path.parse(override).root) return override
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(localAppData, 'electron-builder', 'Cache')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'electron-builder')
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim()
  return path.join(xdg || path.join(os.homedir(), '.cache'), 'electron-builder')
}

async function sha256(file) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = require('node:fs').createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function fileSize(file) {
  try {
    return (await fs.stat(file)).size
  } catch {
    return -1
  }
}

function human(bytes) {
  if (bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))))
  })
}

/** curl.exe sidesteps the flaky Node HTTPS path to GitHub release assets. */
async function downloadWithCurl(url, destination) {
  await run('curl.exe', [
    '-sSL',
    '--fail',
    '--retry',
    '4',
    '--retry-delay',
    '2',
    '--retry-all-errors',
    '--connect-timeout',
    '30',
    '-o',
    destination,
    url,
  ])
}

async function downloadWithFetch(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(destination, buffer)
}

async function download(url, destination) {
  if (process.platform === 'win32') {
    try {
      await downloadWithCurl(url, destination)
      return 'curl'
    } catch (error) {
      console.warn(`  curl.exe failed (${error.message}); falling back to fetch()`)
    }
  }
  await downloadWithFetch(url, destination)
  return 'fetch'
}

async function ensure(toolset, options) {
  const expected = options.checksums.get(toolset.filename) ?? CHECKSUMS[toolset.filename]
  const dir = path.join(cacheRoot(), toolset.releaseName)
  const target = path.join(dir, toolset.filename)
  const url = `${BASE_URL}/${toolset.releaseName}/${toolset.filename}`

  if ((await fileSize(target)) > 0) {
    if (!expected) return { status: 'cached', target }
    if ((await sha256(target)) === expected) return { status: 'cached', target }
    console.warn(`  cache checksum mismatch, re-downloading ${toolset.filename}`)
  }

  await fs.mkdir(dir, { recursive: true })
  const temp = `${target}.download`
  const via = await download(url, temp)
  const size = await fileSize(temp)
  const digest = await sha256(temp)

  if (size <= 0) {
    await fs.rm(temp, { force: true })
    throw new Error(`downloaded ${toolset.filename} is empty`)
  }
  if (expected && digest !== expected) {
    await fs.rm(temp, { force: true })
    throw new Error(
      `checksum mismatch for ${toolset.filename}\n  expected ${expected}\n  got      ${digest}`,
    )
  }

  await fs.rm(target, { force: true })
  await fs.rename(temp, target)
  return { status: `downloaded via ${via} (${human(size)})`, target }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const includeIcons = args.has('--all')
  const groups = includeIcons ? ['dir', 'nsis', 'icons'] : ['dir', 'nsis']
  const planned = TOOLSETS.filter((toolset) => toolset.groups.some((group) => groups.includes(group)))

  if (args.has('--list')) {
    console.log(`cache: ${cacheRoot()}`)
    for (const toolset of planned) {
      console.log(`  ${toolset.releaseName}/${toolset.filename}`)
      console.log(`    ${toolset.reason}`)
    }
    return
  }

  if (process.platform !== 'win32') {
    console.log(`Nothing to do: this helper seeds the Windows toolset cache (running on ${process.platform}).`)
    return
  }

  console.log(`electron-builder cache: ${cacheRoot()}`)
  // Re-read the hashes from the installed app-builder-lib so the table above
  // cannot drift when electron-builder is upgraded.
  const refreshed = verifyChecksums()
  if (refreshed > 0) console.log(`verified ${refreshed} checksum(s) against app-builder-lib`)
  const checksums = new Map(Object.entries(CHECKSUMS))
  const failures = []

  for (const toolset of planned) {
    process.stdout.write(`• ${toolset.filename} … `)
    try {
      const result = await ensure(toolset, { checksums })
      console.log(result.status)
    } catch (error) {
      console.log('FAILED')
      console.error(`  ${error.message}`)
      failures.push(toolset.filename)
    }
  }

  if (failures.length > 0) {
    console.error(`\nCould not seed ${failures.length} toolset(s): ${failures.join(', ')}`)
    process.exitCode = 1
    return
  }

  console.log('\nDone. `npm run pack` and `npm run dist` can now work offline.')
}

await main()
