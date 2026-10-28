/**
 * Entry point of the Android build.
 *
 * `install` must come first: it assigns `window.kolaars`, and the shared modules
 * imported by `./main` read that global while they are being evaluated.
 */

import './platform/android/install'
import './main'
import './styles/mobile.css'
