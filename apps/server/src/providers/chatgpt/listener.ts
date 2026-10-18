import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { CALLBACK_PATH } from '@faire/core'

export interface LoopbackListener {
  /** The port actually bound (differs from the request when 0 was asked for). */
  port: number
  /** Stops listening and drops open connections. Safe to call twice. */
  close(): Promise<void>
}

export interface LoopbackListenerOptions {
  host: string
  port: number
  /** Called once with the callback's query. A throw or rejection is swallowed: the page is already sent. */
  onCallback(params: URLSearchParams): void | Promise<void>
}

export type StartListener = (options: LoopbackListenerOptions) => Promise<LoopbackListener>

/**
 * Static page. It never echoes the code, state or any error from the query: those are
 * credentials in flight, and the page can be read by anything that can see the browser tab.
 */
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Faire</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:1.5rem}</style>
</head>
<body><main><h1>You can close this window</h1><p>Return to Faire to continue.</p></main></body>
</html>
`

function reply(res: ServerResponse, status: number, body: string, type = 'text/plain'): void {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    connection: 'close',
  })
  res.end(body)
}

/**
 * A one-shot HTTP listener for the OAuth redirect. It answers GET {CALLBACK_PATH} once, hands
 * the query to `onCallback`, then closes. Requests for other paths or methods, or with a
 * foreign Host header (DNS rebinding), are refused without using up the attempt.
 */
export function startLoopbackListener({
  host,
  port,
  onCallback,
}: LoopbackListenerOptions): Promise<LoopbackListener> {
  return new Promise((resolve, reject) => {
    let bound = port
    let done = false
    let closing: Promise<void> | undefined

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.headers.host !== `127.0.0.1:${bound}`) return reply(res, 400, 'Bad request')
      if (url.pathname !== CALLBACK_PATH) return reply(res, 404, 'Not found')
      if (req.method !== 'GET') return reply(res, 405, 'Method not allowed')
      if (done) return reply(res, 410, 'Gone')
      done = true
      reply(res, 200, PAGE, 'text/html')
      res.once('close', () => {
        void close()
        // The handler runs after the browser has its page, and its failure cannot reach the browser.
        Promise.resolve()
          .then(() => onCallback(url.searchParams))
          .catch(() => {})
      })
    })

    function close(): Promise<void> {
      closing ??= new Promise<void>((resolveClose) => {
        if (!server.listening) return resolveClose()
        server.close(() => resolveClose())
        server.closeAllConnections()
      })
      return closing
    }

    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      const address = server.address()
      bound = typeof address === 'object' && address ? address.port : port
      resolve({ port: bound, close })
    })
  })
}
