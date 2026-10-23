// Renders the branded installer art (PLAN D1.7b) from its SVG sources into the bitmaps NSIS
// loads, plus PNG previews for review.
//
//   pnpm --filter @mawl/desktop art [--zoom <dir>]
//
// Each SVG in design/assets/installer is drawn by a real browser (Playwright with the local
// Edge; set MAWL_ART_CHANNEL to use another Chromium channel) at RENDER_SCALE times its size,
// area-averaged down to 1x, grained and written as an uncompressed 24-bit BMP. The BMPs are
// committed, so `tauri build` never needs this step; rerun it after editing the art. `--zoom`
// also writes nearest-neighbour 8x copies of the final pixels for close inspection.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { encodeBmp24 } from './bmp.ts'
import { boxDownsample, quantize, type Rgb } from './pixels.ts'
import { encodePng } from './png.ts'

export const RENDER_SCALE = 4

export interface ArtSpec {
  name: string
  width: number
  height: number
  /** Composited under the render; also the color the art meets at its blending edges. */
  background: Rgb
  grain: number
  seed: number
}

/** The sizes MUI2 lays out at 100% scaling (Tauri's schema recommends the same). */
export const INSTALLER_ART: readonly ArtSpec[] = [
  {
    name: 'sidebar',
    width: 164,
    height: 314,
    background: [11, 14, 8],
    grain: 2.2,
    seed: 0x6d61776c,
  },
  // The header sits on MUI_BGCOLOR (white, see installer/hooks.nsh) and must meet it seamlessly,
  // so it gets no grain.
  { name: 'header', width: 150, height: 57, background: [255, 255, 255], grain: 0, seed: 1 },
]

const desktop = resolve(import.meta.dirname, '../..')
export const ART_SOURCE_DIR = resolve(desktop, '../../design/assets/installer')
export const ART_OUTPUT_DIR = resolve(desktop, 'src-tauri/installer')

// Runs in the page (this package has no DOM types, so it is kept as source text): draws the SVG
// onto a canvas at render size and returns the RGBA pixels as base64.
const BROWSER_RASTERIZE = `async ({ svg, w, h }) => {
  const img = new Image(w, h)
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let bin = ''
  for (let i = 0; i < data.length; i += 0x8000) {
    bin += String.fromCharCode(...data.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}`

function nearestUpscale(rgb: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(width * k * height * k * 3)
  for (let y = 0; y < height * k; y++) {
    for (let x = 0; x < width * k; x++) {
      const s = (Math.floor(y / k) * width + Math.floor(x / k)) * 3
      const d = (y * width * k + x) * 3
      out[d] = rgb[s] ?? 0
      out[d + 1] = rgb[s + 1] ?? 0
      out[d + 2] = rgb[s + 2] ?? 0
    }
  }
  return out
}

async function main(args: string[]): Promise<number> {
  const zoomAt = args.indexOf('--zoom')
  const zoomDir = zoomAt >= 0 ? args[zoomAt + 1] : undefined
  if (zoomAt >= 0 && !zoomDir) {
    process.stderr.write('usage: render.ts [--zoom <dir>]\n')
    return 2
  }
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: process.env.MAWL_ART_CHANNEL ?? 'msedge' })
  try {
    const page = await browser.newPage()
    await mkdir(ART_OUTPUT_DIR, { recursive: true })
    for (const art of INSTALLER_ART) {
      const svg = await readFile(join(ART_SOURCE_DIR, `${art.name}.svg`), 'utf8')
      const w = art.width * RENDER_SCALE
      const h = art.height * RENDER_SCALE
      const base64 = await page.evaluate<string>(
        `(${BROWSER_RASTERIZE})(${JSON.stringify({ svg, w, h })})`,
      )
      const rgba = new Uint8Array(Buffer.from(base64, 'base64'))
      const rgb = quantize(boxDownsample(rgba, w, h, RENDER_SCALE, art.background), art)
      await writeFile(
        join(ART_OUTPUT_DIR, `${art.name}.bmp`),
        encodeBmp24(art.width, art.height, rgb),
      )
      await writeFile(
        join(ART_SOURCE_DIR, `${art.name}.png`),
        encodePng(art.width, art.height, rgb),
      )
      if (zoomDir) {
        await mkdir(zoomDir, { recursive: true })
        const k = 8
        const big = nearestUpscale(rgb, art.width, art.height, k)
        await writeFile(
          join(zoomDir, `${art.name}@${k}x.png`),
          encodePng(art.width * k, art.height * k, big),
        )
      }
      process.stdout.write(`${art.name}: ${art.width}x${art.height}\n`)
    }
  } finally {
    await browser.close()
  }
  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
