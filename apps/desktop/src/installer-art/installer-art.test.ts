import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeBmp24, encodeBmp24, readBmpHeader } from './bmp.ts'
import { ART_OUTPUT_DIR, ART_SOURCE_DIR, INSTALLER_ART } from './render.ts'

const hooks = readFileSync(join(ART_OUTPUT_DIR, 'hooks.nsh'), 'utf8')
const defines = new Map(
  [...hooks.matchAll(/^!define\s+(\w+)(?:\s+"([^"]*)")?\s*$/gm)].map((m) => [m[1], m[2]]),
)

describe('the committed installer art', () => {
  for (const art of INSTALLER_ART) {
    const bmp = new Uint8Array(readFileSync(join(ART_OUTPUT_DIR, `${art.name}.bmp`)))

    it(`${art.name}.bmp is an uncompressed 24-bit ${art.width}x${art.height} bitmap`, () => {
      expect(readBmpHeader(bmp)).toEqual({
        width: art.width,
        height: art.height,
        bitsPerPixel: 24,
        compression: 0,
        topDown: false,
        dataOffset: 54,
        fileSize: bmp.byteLength,
      })
    })

    it(`${art.name}.bmp has exactly the header the render step writes`, () => {
      // Pixel values depend on the browser build, so only the file structure is pinned.
      const fresh = encodeBmp24(art.width, art.height, new Uint8Array(art.width * art.height * 3))
      expect(bmp.byteLength).toBe(fresh.byteLength)
      expect([...bmp.subarray(0, 54)]).toEqual([...fresh.subarray(0, 54)])
    })

    it(`${art.name}.bmp has real picture content, not a blank or uniform body`, () => {
      const rgb = decodeBmp24(bmp)
      let min = 255
      let max = 0
      for (const value of rgb) {
        if (value < min) min = value
        if (value > max) max = value
      }
      expect(max - min).toBeGreaterThan(100)
    })

    it(`${art.name} has its SVG source and a PNG preview`, () => {
      const svg = readFileSync(join(ART_SOURCE_DIR, `${art.name}.svg`), 'utf8')
      expect(svg).toContain(`viewBox="0 0 ${art.width} ${art.height}"`)
      const png = readFileSync(join(ART_SOURCE_DIR, `${art.name}.png`))
      expect(png.readUInt32BE(16)).toBe(art.width)
      expect(png.readUInt32BE(20)).toBe(art.height)
    })
  }

  it('the header meets the white MUI header strip without a seam', () => {
    const bg = defines.get('MUI_BGCOLOR')
    expect(bg).toBe('FFFFFF')
    const header = INSTALLER_ART.find((a) => a.name === 'header')
    if (!header) throw new Error('no header art')
    expect(header.background).toEqual([255, 255, 255])
    const rgb = decodeBmp24(new Uint8Array(readFileSync(join(ART_OUTPUT_DIR, 'header.bmp'))))
    const at = (x: number, y: number) => [...rgb.subarray((y * 150 + x) * 3, (y * 150 + x) * 3 + 3)]
    // The image sits on the right of the strip (MUI_HEADERIMAGE_RIGHT): its left and top edges
    // touch the white header, so they must be white too.
    expect(defines.has('MUI_HEADERIMAGE_RIGHT')).toBe(true)
    for (let y = 0; y < 57; y++) expect(at(0, y)).toEqual([255, 255, 255])
    for (let x = 0; x < 80; x++) expect(at(x, 0)).toEqual([255, 255, 255])
  })
})

describe('the installer hooks', () => {
  it('defines only MUI settings that the Tauri template leaves free', () => {
    // Tauri !includes the hooks before its own MUI defines; redefining one of those
    // (MUI_FINISHPAGE_RUN, MUI_ICON, MUI_HEADERIMAGE_BITMAP, ...) fails makensis. This list is
    // checked against itself: the real guard is a `tauri build`, which makensis rejects on a clash.
    const code = hooks
      .split('\n')
      .filter((line) => !line.trimStart().startsWith(';'))
      .join('\n')
    for (const taken of [
      'MUI_ICON',
      'MUI_FINISHPAGE_RUN',
      'MUI_HEADERIMAGE_BITMAP',
      'MUI_WELCOMEFINISHPAGE_BITMAP',
    ]) {
      expect(code).not.toMatch(new RegExp(`${taken}(?![A-Z_])`))
    }
    expect([...defines.keys()].sort()).toEqual(
      [
        'MUI_BGCOLOR',
        'MUI_FINISHPAGE_RUN_TEXT',
        'MUI_FINISHPAGE_TEXT',
        'MUI_FINISHPAGE_TITLE',
        'MUI_HEADERIMAGE_RIGHT',
        'MUI_WELCOMEPAGE_TEXT',
        'MUI_WELCOMEPAGE_TITLE',
      ].sort(),
    )
  })

  it('speaks Mawl on the welcome and finish pages, with a Launch Mawl checkbox', () => {
    expect(defines.get('MUI_WELCOMEPAGE_TITLE')).toBe('Mawl is moving in')
    expect(defines.get('MUI_FINISHPAGE_TITLE')).toBe('Mawl is all set')
    expect(defines.get('MUI_FINISHPAGE_RUN_TEXT')).toBe('Launch Mawl')
    expect(defines.get('MUI_WELCOMEPAGE_TEXT')).toContain('admin rights')
    expect(defines.get('MUI_FINISHPAGE_TEXT')).toContain('Start menu')
  })
})
