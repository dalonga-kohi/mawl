import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng } from './png.ts'

describe('encodePng', () => {
  it('writes an 8-bit RGB PNG whose rows inflate back to the pixels', () => {
    const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9])
    const png = encodePng(2, 2, rgb)
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(new TextDecoder().decode(png.subarray(12, 16))).toBe('IHDR')
    expect(view.getUint32(16)).toBe(2)
    expect(view.getUint32(20)).toBe(2)
    expect(png[24]).toBe(8) // bit depth
    expect(png[25]).toBe(2) // truecolor RGB
    const idatLength = view.getUint32(33)
    expect(new TextDecoder().decode(png.subarray(37, 41))).toBe('IDAT')
    const raw = inflateSync(png.subarray(41, 41 + idatLength))
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 9, 9])
    expect(new TextDecoder().decode(png.subarray(-8, -4))).toBe('IEND')
  })
})
