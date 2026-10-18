/**
 * electron-builder `afterPack` hook.
 *
 * The build sets `electronDist: node_modules/electron/dist` so packaging never
 * has to download the Electron release zip. Because that path treats Electron as
 * a "custom" distribution, electron-builder skips its usual cleanup and leaves
 * Electron's stub application (`resources/default_app.asar`) in the output.
 *
 * Nothing loads it — our own `app.asar` wins — but it is 100 KB of dead weight,
 * so drop it here. Failures are only warnings: shipping an extra stub file is
 * harmless, and we would rather not break a build over it.
 */

const fs = require('node:fs/promises')
const path = require('node:path')

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function afterPack(context) {
  const resourcesDir =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')

  const stub = path.join(resourcesDir, 'default_app.asar')
  try {
    await fs.rm(stub, { force: true })
  } catch (error) {
    console.warn(`after-pack: could not remove ${stub}: ${error.message}`)
  }
}
