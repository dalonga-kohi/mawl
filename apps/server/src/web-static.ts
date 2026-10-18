import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@hono/node-server/serve-static'
import type { MiddlewareHandler } from 'hono'
import { checkHost, type HostPolicy } from './events/host.ts'

/** Paths owned by the API. The static handler never answers them, so a missing procedure stays a 404. */
const RESERVED = /^\/(rpc|ws|healthz)(\/|$)/

/** Percent escapes, backslashes, `.`/`..` or hidden segments, empty segments: never mapped to a file. */
const UNSAFE_PATH = /%|\\|\/\/|\/\.[^/]*(?=\/|$)/

const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * The directory to serve: the configured one, else `web` beside the bundle (`dist/web` in the image)
 * when it holds an index.html, else none (dev serves the web app from Vite).
 */
export function resolveWebDir(
  configured: string | undefined,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (configured) return configured
  const beside = fileURLToPath(new URL('./web', import.meta.url))
  return exists(join(beside, 'index.html')) ? beside : undefined
}

export interface WebStaticOptions {
  /** Absolute directory of the built web app. */
  dir: string
  /** When set, requests must pass the same Host check as /rpc. */
  hosts?: HostPolicy | undefined
}

function acceptsHtml(accept: string | undefined): boolean {
  return accept?.toLowerCase().includes('text/html') ?? false
}

/**
 * Serves the Vite build. GET and HEAD only. Real files are sent as they are; a path with no file
 * falls back to index.html when a browser asks for a page (client-side routes), and is a 404 for
 * assets and anything with a file extension. Install after the API routes.
 */
export function webStatic({ dir, hosts }: WebStaticOptions): MiddlewareHandler {
  const root = resolve(dir)
  const files = serveStatic({ root })
  const index = serveStatic({ root, path: '/index.html' })

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    const path = c.req.path
    if (RESERVED.test(path)) return next()
    if (hosts) {
      const verdict = checkHost(c.req.header('host'), hosts)
      if (!verdict.ok) return c.json({ ok: false }, 403)
    }
    if (UNSAFE_PATH.test(path)) return next()

    let missed = false
    const miss = async () => {
      missed = true
    }
    let served = await files(c, miss)
    let isIndex = path === '/' || path === '/index.html'
    if (missed) {
      const lastSegment = path.slice(path.lastIndexOf('/') + 1)
      const isPage =
        !path.startsWith('/assets/') &&
        !lastSegment.includes('.') &&
        acceptsHtml(c.req.header('accept'))
      if (!isPage) return next()
      missed = false
      served = await index(c, miss)
      if (missed) return next()
      isIndex = true
    }
    if (!served) return next()

    // Set on the finished response: the file handler builds it, and misses must stay unmarked.
    const headers = served.headers
    headers.set('cache-control', !isIndex && path.startsWith('/assets/') ? IMMUTABLE : 'no-cache')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('referrer-policy', 'no-referrer')
    headers.set('content-security-policy', "frame-ancestors 'none'")
    return served
  }
}
