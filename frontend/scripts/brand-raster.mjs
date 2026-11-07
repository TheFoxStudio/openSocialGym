// Decode the normalized RGB PNG without adding native dependencies to frontend CI.
// The original upload is retained separately; brand-icon.png is opaque 8-bit RGB.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
let image
function source() {
  if (image) return image
  const bytes = readFileSync(new URL('../resources/brand-icon.png', import.meta.url))
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (bytes[24] !== 8 || bytes[25] !== 2 || bytes[28] !== 0) throw Error('Normalize brand-icon.png to noninterlaced 8-bit RGB first')
  const chunks = []
  for (let p = 8; p < bytes.length;) {
    const length = bytes.readUInt32BE(p), type = bytes.toString('ascii', p + 4, p + 8)
    if (type === 'IDAT') chunks.push(bytes.subarray(p + 8, p + 8 + length))
    p += length + 12
  }
  const packed = inflateSync(Buffer.concat(chunks)), stride = width * 3, pixels = Buffer.alloc(stride * height)
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c }
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]
    if (filter > 4) throw Error('Invalid PNG filter')
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 3 ? pixels[i - 3] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= 3 ? pixels[i - stride - 3] : 0
      pixels[i] = packed[y * (stride + 1) + x + 1] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)
    }
  }
  return image = { width, height, pixels }
}
export function brandPixels(size, { round = false, color = null } = {}) {
  const { width, height, pixels } = source(), channels = round ? 4 : 3, out = Buffer.alloc(size * size * channels)
  const tint = color && [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.max(0, Math.min(width - 1, (x + .5) * width / size - .5)), sy = Math.max(0, Math.min(height - 1, (y + .5) * height / size - .5))
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = sx - x0, fy = sy - y0
    const rgb = [0, 1, 2].map(c => (pixels[(y0 * width + x0) * 3 + c] * (1 - fx) + pixels[(y0 * width + x1) * 3 + c] * fx) * (1 - fy) + (pixels[(y1 * width + x0) * 3 + c] * (1 - fx) + pixels[(y1 * width + x1) * 3 + c] * fx) * fy)
    if (tint && rgb[2] > 65 && rgb[2] > rgb[0] * 1.5) {
      const brightness = Math.max(...rgb) / 255, highlight = Math.min(...rgb) / 255
      for (let c = 0; c < 3; c++) rgb[c] = tint[c] * brightness * (1 - highlight) + 255 * highlight
    }
    const offset = (y * size + x) * channels
    for (let c = 0; c < 3; c++) out[offset + c] = Math.round(rgb[c])
    if (round) out[offset + 3] = Math.round(255 * Math.min(1, Math.max(0, size / 2 - Math.hypot(x + .5 - size / 2, y + .5 - size / 2) + .5)))
  }
  return out
}
