// A minimal PNG writer for the installer art previews: 8-bit RGB, no filtering, zlib from Node.
import { crc32, deflateSync } from 'node:zlib'

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)))
  return out
}

/** Encodes top-down, tightly packed RGB pixels as a PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.byteLength !== width * height * 3) {
    throw new Error(`expected ${width * height * 3} bytes of RGB, got ${rgb.byteLength}`)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = width * 3
  const raw = new Uint8Array((row + 1) * height)
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * row, (y + 1) * row), y * (row + 1) + 1)
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}
