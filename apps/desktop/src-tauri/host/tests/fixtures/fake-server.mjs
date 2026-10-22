// A stand-in for mawl-server in the supervisor's integration tests. It keeps the host contract:
// the launch token on stdin's first line and the master key on its second, stdin EOF means
// "shut down", /healthz on MAWL_PORT.
// The test picks a behavior by writing `behavior` into the working directory (the data dir),
// because the supervisor clears the environment.
import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'

const behavior = existsSync('behavior') ? readFileSync('behavior', 'utf8').trim() : 'ok'
const log = (msg, extra = {}) =>
  process.stdout.write(`${JSON.stringify({ level: 30, msg, ...extra })}\n`)

let buffered = ''
let token
let key
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (key !== undefined) return
  buffered += chunk
  const lines = buffered.split('\n')
  if (lines.length < 3) return
  ;[token, key] = lines
  boot()
})
process.stdin.on('end', () => {
  log('stdin closed')
  if (behavior === 'ignore-stdin') return
  server?.close()
  process.exit(0)
})

let server
function boot() {
  // A careless dependency printing the token: the host must redact it.
  process.stderr.write(`warning: token=${token}\n`)
  process.stderr.write(`warning: key=${key}\n`)
  log('env', {
    mode: process.env.MAWL_MODE,
    host: process.env.MAWL_HOST,
    port: process.env.MAWL_PORT,
    dataDir: process.env.MAWL_DATA_DIR,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    secret: process.env.OPENAI_API_KEY ?? null,
    tokenLength: token.length,
    keyLength: key.length,
    // Proves which key arrived without printing it.
    keySha256: createHash('sha256').update(key).digest('hex'),
  })
  if (behavior === 'crash-once' && !existsSync('crashed')) {
    writeFileSync('crashed', '1')
    process.exit(3)
  }
  if (behavior === 'grandchild') {
    // Holds a port while alive, so the test can see when the job ended it.
    const child = spawn(
      process.execPath,
      [
        '-e',
        "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{require('fs').writeFileSync('grandchild-port',String(s.address().port))})",
      ],
      { stdio: 'ignore' },
    )
    child.unref()
  }
  log('migrations applied')
  server = http
    .createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const ok =
        url.pathname === '/healthz' && req.headers.host === `127.0.0.1:${process.env.MAWL_PORT}`
      const nonce = url.searchParams.get('n')
      // The same identity proof the real server gives (apps/server/src/health-identity.ts).
      const id = nonce
        ? createHmac('sha256', token)
            .update(`mawl/healthz-identity/v1:${nonce}`)
            .digest('base64url')
        : undefined
      const body = JSON.stringify(id ? { ok, id } : { ok })
      res.writeHead(ok ? 200 : 503, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    })
    .listen(Number(process.env.MAWL_PORT), '127.0.0.1', () => log('listening'))
}
