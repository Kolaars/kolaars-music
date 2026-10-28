import { renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Capacitor serves `index.html` from `webDir`, while Vite names the output after
 * its input file. This tiny plugin renames `index.mobile.html` to `index.html`
 * so the shared desktop `index.html` can keep pointing at the Electron entry.
 */
function capacitorIndex(outDir: string): Plugin {
  return {
    name: 'capacitor-index',
    closeBundle() {
      try {
        renameSync(resolve(outDir, 'index.mobile.html'), resolve(outDir, 'index.html'))
      } catch {
        /* already renamed or the build failed */
      }
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@data': resolve(__dirname, 'data')
    }
  },
  plugins: [react(), capacitorIndex(resolve(__dirname, 'out/mobile'))],
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.mobile.html') }
    }
  }
})
