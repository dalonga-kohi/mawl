import { describe, expect, it } from 'vitest'
import { decodeBmp24, encodeBmp24, readBmpHeader } from './bmp.ts'

/** A top-down RGB buffer where every pixel encodes its own position. */
function gradient(width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      rgb[i] = x
      rgb[i + 1] = y
      rgb[i + 2] = (x + y) % 256
    }
  }
  return rgb
}

describe('encodeBmp24', () => {
  it('writes an uncompressed 24-bit BITMAPINFOHEADER file that NSIS can load', () => {
    const bmp = encodeBmp24(150, 57, gradient(150, 57))
    const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength)
    expect(String.fromCharCode(bmp[0] ?? 0, bmp[1] ?? 0)).toBe('BM')
    expect(view.getUint32(2, true)).toBe(bmp.byteLength)
    expect(view.getUint32(10, true)).toBe(54)
    expect(view.getUint32(14, true)).toBe(40)
    expect(view.getInt32(18, true)).toBe(150)
    // Positive height: rows are stored bottom-up, the form every loader accepts.
    expect(view.getInt32(22, true)).toBe(57)
    expect(view.getUint16(26, true)).toBe(1)
    expect(view.getUint16(28, true)).toBe(24)
    expect(view.getUint32(30, true)).toBe(0)
    // 150 * 3 = 450 bytes per row, padded to 452.
    expect(view.getUint32(34, true)).toBe(452 * 57)
    expect(bmp.byteLength).toBe(54 + 452 * 57)
  })

  it('stores rows bottom-up in BGR order with zeroed padding', () => {
    const bmp = encodeBmp24(2, 2, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
    // Row stride is 6 bytes padded to 8. The bottom row (7..12) comes first.
    expect([...bmp.subarray(54)]).toEqual([9, 8, 7, 12, 11, 10, 0, 0, 3, 2, 1, 6, 5, 4, 0, 0])
  })

  it('rejects a buffer that does not match the size', () => {
    expect(() => encodeBmp24(2, 2, new Uint8Array(11))).toThrow(/12 bytes/)
    expect(() => encodeBmp24(0, 2, new Uint8Array(0))).toThrow(/positive/)
  })
})

describe('readBmpHeader and decodeBmp24', () => {
  it('round-trip what the encoder wrote', () => {
    const rgb = gradient(164, 314)
    const bmp = encodeBmp24(164, 314, rgb)
    expect(readBmpHeader(bmp)).toEqual({
      width: 164,
      height: 314,
      bitsPerPixel: 24,
      compression: 0,
      topDown: false,
      dataOffset: 54,
      fileSize: bmp.byteLength,
    })
    // Not toEqual: vitest walks a 154k-element typed array one element at a time, which timed
    // out (5 s) on a loaded CI runner. A byte comparison is the same check without the walk.
    expect(Buffer.from(decodeBmp24(bmp)).equals(Buffer.from(rgb))).toBe(true)
  })

  it('refuses a file that is not a BMP', () => {
    expect(() => readBmpHeader(new Uint8Array(60))).toThrow(/not a BMP/)
  })
})
