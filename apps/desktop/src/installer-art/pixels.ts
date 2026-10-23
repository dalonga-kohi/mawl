// Turns a high-resolution browser render into the final installer pixels: an area-average
// downsample (crisper than the browser's own scaling at these tiny sizes) and an optional,
// seeded luminance grain that also breaks up 8-bit banding in the dark gradients.

export type Rgb = readonly [number, number, number]

/**
 * Averages every `factor` x `factor` block of a top-down RGBA render into one RGB pixel, after
 * compositing it over `background`. Returns unrounded channel values (0..255).
 */
export function boxDownsample(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
  background: Rgb,
): Float32Array {
  if (width % factor !== 0 || height % factor !== 0) {
    throw new Error(`factor ${factor} does not divide ${width}x${height}`)
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(`expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`)
  }
  const w = width / factor
  const h = height / factor
  const out = new Float32Array(w * h * 3)
  const area = factor * factor
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < factor; dy++) {
        let i = ((y * factor + dy) * width + x * factor) * 4
        for (let dx = 0; dx < factor; dx++, i += 4) {
          const a = (rgba[i + 3] ?? 0) / 255
          r += (rgba[i] ?? 0) * a + background[0] * (1 - a)
          g += (rgba[i + 1] ?? 0) * a + background[1] * (1 - a)
          b += (rgba[i + 2] ?? 0) * a + background[2] * (1 - a)
        }
      }
      const o = (y * w + x) * 3
      out[o] = r / area
      out[o + 1] = g / area
      out[o + 2] = b / area
    }
  }
  return out
}

/** mulberry32: a tiny seeded PRNG, so the grain is the same on every run. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Rounds RGB floats to bytes. With `grain` > 0 every pixel gets one triangular noise value in
 * (-grain, grain), added to all three channels so the grain stays neutral in hue.
 */
export function quantize(rgb: Float32Array, opts: { grain: number; seed: number }): Uint8Array {
  const next = random(opts.seed)
  const out = new Uint8Array(rgb.length)
  for (let i = 0; i < rgb.length; i += 3) {
    const n = opts.grain > 0 ? (next() - next()) * opts.grain : 0
    for (let c = 0; c < 3; c++) {
      const v = Math.round((rgb[i + c] ?? 0) + n)
      out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
  return out
}
