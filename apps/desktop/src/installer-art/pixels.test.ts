import { describe, expect, it } from 'vitest'
import { boxDownsample, quantize } from './pixels.ts'

describe('boxDownsample', () => {
  it('averages each factor x factor block of the high-resolution render', () => {
    // 2x2 RGBA -> 1x1: four pixels with red 0, 100, 200, 100 average to 100.
    const rgba = Uint8Array.from([0, 0, 0, 255, 100, 4, 0, 255, 200, 8, 0, 255, 100, 0, 0, 255])
    expect([...boxDownsample(rgba, 2, 2, 2, [0, 0, 0])]).toEqual([100, 3, 0])
  })

  it('composites transparent pixels over the background, so a BMP never needs alpha', () => {
    const rgba = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect([...boxDownsample(rgba, 2, 2, 2, [255, 255, 255])]).toEqual([255, 255, 255])
    // Half-covered black over white is mid grey.
    const half = Uint8Array.from([0, 0, 0, 128, 0, 0, 0, 128, 0, 0, 0, 128, 0, 0, 0, 128])
    const [r] = boxDownsample(half, 2, 2, 2, [255, 255, 255])
    expect(r).toBeCloseTo(255 * (1 - 128 / 255), 5)
  })

  it('rejects a size that the factor does not divide', () => {
    expect(() => boxDownsample(new Uint8Array(3 * 2 * 4), 3, 2, 2, [0, 0, 0])).toThrow(/divide/)
  })
})

describe('quantize', () => {
  it('rounds and clamps without grain', () => {
    const out = quantize(Float32Array.from([-3, 12.4, 12.6, 300, 254.5, 0]), { grain: 0, seed: 1 })
    expect([...out]).toEqual([0, 12, 13, 255, 255, 0])
  })

  it('adds the same grain for the same seed and never strays past the amplitude', () => {
    const flat = new Float32Array(3000).fill(60)
    const a = quantize(flat, { grain: 2, seed: 7 })
    const b = quantize(flat, { grain: 2, seed: 7 })
    expect(a).toEqual(b)
    expect(Math.min(...a)).toBeGreaterThanOrEqual(58)
    expect(Math.max(...a)).toBeLessThanOrEqual(62)
    // Grain is luminance noise: the three channels of a pixel move together.
    for (let i = 0; i < a.length; i += 3) {
      expect(a[i]).toBe(a[i + 1])
      expect(a[i]).toBe(a[i + 2])
    }
    expect(new Set(a).size).toBeGreaterThan(2)
  })
})
