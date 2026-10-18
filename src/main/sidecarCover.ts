/**
 * Cover art that lives next to the audio file instead of inside it.
 *
 * Music downloaded from a streaming service is usually stripped of its tags but
 * ships the artwork as a separate image beside every track, under one of a few
 * naming conventions — and a single folder can mix them. This module knows those
 * conventions and picks the most likely match. It deliberately touches nothing
 * but the filesystem so it can be unit-tested on its own
 * (`scripts/test-sidecar-cover.mjs`).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']

/**
 * Candidate file names for `Song.flac`, most specific first:
 *
 *   1. `Song.flac.cover.jpg` — the audio file's own name plus a cover suffix,
 *      which is what Yandex Music writes;
 *   2. `Song.flac.jpg` — the audio file name with just an image extension;
 *   3. `Song.cover.jpg` — the base name plus a suffix;
 *   4. `Song.jpg` — the plain base name, the next most common form;
 *   5. `cover.jpg` / `folder.jpg` — the folder-level fallback every desktop
 *      player honours.
 */
function coverStems(fileName: string, baseName: string): string[] {
  return [
    `${fileName}.cover`,
    `${fileName}-cover`,
    fileName,
    `${baseName}.cover`,
    `${baseName}-cover`,
    baseName,
    'cover',
    'folder'
  ]
}

/**
 * Finds the image that belongs to `filePath`, or `null` when the folder has
 * none. Lookups are case-insensitive, because Windows filenames are, but the
 * name as it exists on disk is what gets returned. Directories and empty files
 * are skipped: a folder called `Song.jpg` is not cover art.
 */
export async function findSidecarCover(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const baseName = path.basename(filePath, path.extname(filePath))

  let present: Map<string, string>
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    present = new Map(entries.filter((e) => e.isFile()).map((e) => [e.name.toLowerCase(), e.name]))
  } catch {
    return null
  }

  for (const stem of coverStems(fileName, baseName)) {
    for (const extension of COVER_EXTENSIONS) {
      const actual = present.get(`${stem}${extension}`.toLowerCase())
      if (!actual) continue
      const full = path.join(dir, actual)
      try {
        if ((await fs.stat(full)).size > 0) return full
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }
  return null
}
