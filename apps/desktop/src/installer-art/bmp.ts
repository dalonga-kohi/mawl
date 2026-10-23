// A minimal Windows bitmap codec for the NSIS installer art (PLAN D1.7b).
//
// NSIS loads the sidebar and header images with LoadImage, which wants an uncompressed 24-bit
// BMP with a BITMAPINFOHEADER and no alpha channel. Nothing in the repo writes BMPs, and the
// format is small enough that a dependency would cost more than these few lines.

const FILE_HEADER = 14
const INFO_HEADER = 40
const HEADER_BYTES = FILE_HEADER + INFO_HEADER

export interface BmpHeader {
  width: number
  height: number
  bitsPerPixel: number
  /** 0 is BI_RGB, uncompressed. */
  compression: number
  /** A negative height in the file means rows are stored top-down. */
  topDown: boolean
  dataOffset: number
  fileSize: number
}

const stride = (width: number) => Math.ceil((width * 3) / 4) * 4

/** Encodes top-down, tightly packed RGB pixels as a bottom-up 24-bit BMP. */
export function encodeBmp24(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`BMP size must be positive integers, got ${width}x${height}`)
  }
  const expected = width * height * 3
  if (rgb.byteLength !== expected) {
    throw new Error(
      `expected ${expected} bytes of RGB for ${width}x${height}, got ${rgb.byteLength}`,
    )
  }
  const rowBytes = stride(width)
  const imageBytes = rowBytes * height
  const out = new Uint8Array(HEADER_BYTES + imageBytes)
  const view = new DataView(out.buffer)
  out[0] = 0x42 // B
  out[1] = 0x4d // M
  view.setUint32(2, out.byteLength, true)
  view.setUint32(10, HEADER_BYTES, true)
  view.setUint32(14, INFO_HEADER, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true) // planes
  view.setUint16(28, 24, true)
  view.setUint32(30, 0, true) // BI_RGB
  view.setUint32(34, imageBytes, true)
  // 2835 px/m is 72 dpi; LoadImage ignores it, but zero confuses some viewers.
  view.setInt32(38, 2835, true)
  view.setInt32(42, 2835, true)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 3
    const dst = HEADER_BYTES + y * rowBytes
    for (let x = 0; x < width; x++) {
      const s = src + x * 3
      const d = dst + x * 3
      out[d] = rgb[s + 2] ?? 0
      out[d + 1] = rgb[s + 1] ?? 0
      out[d + 2] = rgb[s] ?? 0
    }
  }
  return out
}

export function readBmpHeader(bmp: Uint8Array): BmpHeader {
  if (bmp.byteLength < HEADER_BYTES || bmp[0] !== 0x42 || bmp[1] !== 0x4d) {
    throw new Error('not a BMP file')
  }
  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength)
  const rawHeight = view.getInt32(22, true)
  return {
    width: view.getInt32(18, true),
    height: Math.abs(rawHeight),
    bitsPerPixel: view.getUint16(28, true),
    compression: view.getUint32(30, true),
    topDown: rawHeight < 0,
    dataOffset: view.getUint32(10, true),
    fileSize: view.getUint32(2, true),
  }
}

/** Decodes an uncompressed 24-bit BMP back to top-down RGB. */
export function decodeBmp24(bmp: Uint8Array): Uint8Array {
  const h = readBmpHeader(bmp)
  if (h.bitsPerPixel !== 24 || h.compression !== 0) {
    throw new Error(`only uncompressed 24-bit BMPs are supported, got ${h.bitsPerPixel}-bit`)
  }
  const rowBytes = stride(h.width)
  const rgb = new Uint8Array(h.width * h.height * 3)
  for (let y = 0; y < h.height; y++) {
    const fileRow = h.topDown ? y : h.height - 1 - y
    const src = h.dataOffset + fileRow * rowBytes
    for (let x = 0; x < h.width; x++) {
      const s = src + x * 3
      const d = (y * h.width + x) * 3
      rgb[d] = bmp[s + 2] ?? 0
      rgb[d + 1] = bmp[s + 1] ?? 0
      rgb[d + 2] = bmp[s] ?? 0
    }
  }
  return rgb
}
