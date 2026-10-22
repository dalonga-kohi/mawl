import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import { classifyAddress } from './address.ts'

/** The request was refused before any connection: the address is never or not yet allowed. */
export class EgressBlockedError extends Error {
  constructor(readonly why: 'blocked' | 'private') {
    super(
      why === 'blocked'
        ? 'refused: the address is link-local, metadata or otherwise never reachable'
        : 'refused: the address is on a private network and private addresses are not allowed',
    )
    this.name = 'EgressBlockedError'
  }
}

/** Every address a name resolves to. */
export type ResolveHost = (hostname: string) => Promise<{ address: string; family: number }[]>

/** Sends `init` to `url`, connecting to `address` (already vetted) instead of resolving again. */
export type PinnedTransport = (url: URL, init: RequestInit, address: string) => Promise<Response>

export interface GuardedFetchOptions {
  /** Owner opt-in for loopback and private networks (Ollama on the LAN). */
  allowPrivate: boolean
  /** Defaults to the system resolver (`dns.lookup`, all answers). */
  resolve?: ResolveHost
  /** Defaults to node:http(s) with the connection pinned to the vetted address. */
  transport?: PinnedTransport
}

const systemResolve: ResolveHost = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses: LookupAddress[]) =>
      err ? reject(err) : resolve(addresses),
    )
  })

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

function headersOf(res: IncomingMessage): Headers {
  const out = new Headers()
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) out.append(name, v)
  }
  return out
}

/**
 * node:http(s) with a `lookup` that always answers the vetted address, so the name is resolved
 * once (by the guard) and a second, rebound answer can never be used. TLS still verifies the
 * certificate against the name in the url. Redirects are never followed.
 */
export const pinnedTransport: PinnedTransport = (url, init, address) =>
  new Promise((resolve, reject) => {
    const family = isIP(address)
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }])
      else callback(null, address, family)
    }
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value
    })
    const body = typeof init.body === 'string' ? init.body : undefined
    if (init.body != null && body === undefined) {
      reject(new TypeError('guarded fetch sends string bodies only'))
      return
    }
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(
      url,
      {
        method: init.method ?? 'GET',
        headers,
        lookup,
        // A fresh connection per request: a pooled socket could belong to another pin.
        agent: false,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && init.redirect === 'error') {
          res.resume()
          reject(new TypeError('redirect refused'))
          return
        }
        const nullBody = NULL_BODY_STATUSES.has(status) || init.method === 'HEAD'
        if (nullBody) res.resume()
        resolve(
          new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
            status,
            headers: headersOf(res),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })

/**
 * A fetch for urls the owner typed (SSRF guard). Before connecting it resolves the name once,
 * refuses when any answer is `blocked` (metadata, link-local, unspecified) or, without the
 * opt-in, `private`, and then connects to the first answer only. Literal addresses skip DNS.
 */
export function createGuardedFetch({
  allowPrivate,
  resolve = systemResolve,
  transport = pinnedTransport,
}: GuardedFetchOptions): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(hostname) ? [hostname] : (await resolve(hostname)).map((a) => a.address)
    if (addresses.length === 0) throw new TypeError('name did not resolve')
    const classes = addresses.map(classifyAddress)
    if (classes.includes('blocked')) throw new EgressBlockedError('blocked')
    if (!allowPrivate && classes.includes('private')) throw new EgressBlockedError('private')
    return transport(url, init, addresses[0] as string)
  }) as typeof globalThis.fetch
}
