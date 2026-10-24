import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Standalone local preview; never run or cached by Turbo.
const reference = process.env.MAWL_REFERENCE_DIR
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
}
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const isReference = reference && pathname.startsWith('/reference/')
    const base = isReference ? resolve(reference) : root
    const relative = isReference ? pathname.slice(11) : pathname.slice(1)
    const file = resolve(base, relative || 'index.html')
    if (!file.startsWith(base + sep)) {
      res.writeHead(403).end()
      return
    }
    const info = await stat(file)
    if (!info.isFile()) {
      res.writeHead(404).end()
      return
    }
    const headers = {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
    }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    if (range) {
      const start = Number(range[1])
      const end = Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1)
      if (start > end) {
        res.writeHead(416).end()
        return
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': end - start + 1,
      })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': info.size })
      createReadStream(file).pipe(res)
    }
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(4173, '127.0.0.1', () => console.log('Mawl preview: http://127.0.0.1:4173'))
