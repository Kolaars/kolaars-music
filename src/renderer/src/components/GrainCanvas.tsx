/**
 * Film grain over the artwork of the big screen.
 *
 * A handful of noise tiles are baked once and then cycled as a canvas pattern.
 * Recomputing noise every frame would cost far more than it looks like, and the
 * eye reads the cycling as grain rather than as a loop. Drawn only over the
 * cover, blended into it, and stopped entirely when the window is hidden or the
 * user asked for reduced motion.
 */

import { useEffect, useRef, type JSX } from 'react'

/** Edge of one noise tile, in CSS pixels. */
const TILE = 128
/** How many distinct noise frames are cycled. */
const FRAMES = 5
/** One frame every ~70 ms: a film-ish cadence without the CPU bill. */
const INTERVAL = 70

function bakeTiles(): HTMLCanvasElement[] {
  return Array.from({ length: FRAMES }, () => {
    const tile = document.createElement('canvas')
    tile.width = TILE
    tile.height = TILE
    const context = tile.getContext('2d')
    if (!context) return tile
    const image = context.createImageData(TILE, TILE)
    for (let i = 0; i < image.data.length; i += 4) {
      const value = 84 + Math.round(Math.random() * 88)
      image.data[i] = value
      image.data[i + 1] = value
      image.data[i + 2] = value
      image.data[i + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return tile
  })
}

export function GrainCanvas({ className }: { className?: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const patterns = bakeTiles().map((tile) => context.createPattern(tile, 'repeat'))
    let frame = 0
    let timer = 0

    const draw = (): void => {
      if (document.hidden) return
      const width = Math.max(1, Math.round(canvas.clientWidth))
      const height = Math.max(1, Math.round(canvas.clientHeight))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const pattern = patterns[frame % patterns.length]
      frame += 1
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, width, height)
      if (!pattern) return
      // Offset the tile as well as swapping it, so the pattern never marches.
      context.translate(-Math.floor(Math.random() * TILE), -Math.floor(Math.random() * TILE))
      context.fillStyle = pattern
      context.fillRect(0, 0, width + TILE, height + TILE)
    }

    draw()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduced) timer = window.setInterval(draw, INTERVAL)

    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
