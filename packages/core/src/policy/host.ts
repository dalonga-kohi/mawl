import { isIPv4 } from 'node:net'
import { classifyAddress } from '../net/address.ts'

/**
 * The host a `web_fetch` url points at, as the policy engine sees it:
 * - `invalid`: not an http(s) url, or it carries credentials (`user@host` tricks).
 * - `local`: this machine, the owner's network or a name that only makes sense there (single-label
 *   names, `.local`, `.lan`, `.internal`, `.home.arpa`, `localhost`, well-known DNS names that
 *   resolve to loopback). Always `block`.
 * - `public`: anything else, with the normalized host name (lowercase, punycode, no trailing dot,
 *   no port; IPv6 in brackets).
 *
 * This is a first line only. A public name can still resolve to a private address (DNS rebinding);
 * the egress guard re-resolves and vets every hop at fetch time. Neither can stop a request to the
 * host's own public IP that a router hairpins back to the LAN (hairpin NAT): only network config can.
 */
export type UrlHost = { kind: 'invalid' } | { kind: 'local' } | { kind: 'public'; host: string }

/** Suffixes that name hosts on the owner's own network (RFC 6762, 8375, common router defaults). */
const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'lan',
  'home',
  'home.arpa',
  'internal',
  'intranet',
  'corp',
  'private',
]

/** Public DNS names that resolve to loopback or to an address spelt inside the name. */
const LOOPBACK_DNS = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'vcap.me',
  'traefik.me',
  'lacolhost.com',
]

const endsWith = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`)

/** Classifies an already parsed (WHATWG-normalized) host name. */
function classifyHostname(hostname: string): UrlHost {
  const host = hostname.replace(/\.+$/, '')
  if (host === '') return { kind: 'invalid' }
  if (host.startsWith('[')) {
    return classifyAddress(host.slice(1, -1)) === 'public'
      ? { kind: 'public', host }
      : { kind: 'local' }
  }
  // The URL parser already turned 0x7f.1, 2130706433 and 0177.0.0.1 into dotted decimal.
  if (isIPv4(host)) {
    return classifyAddress(host) === 'public' ? { kind: 'public', host } : { kind: 'local' }
  }
  if (!host.includes('.')) return { kind: 'local' }
  if (LOCAL_SUFFIXES.some((s) => endsWith(host, s))) return { kind: 'local' }
  if (LOOPBACK_DNS.some((s) => endsWith(host, s))) return { kind: 'local' }
  return { kind: 'public', host }
}

/** The host of a model-supplied url, parsed with the WHATWG URL parser (the one `fetch` uses). */
export function urlHost(raw: string): UrlHost {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'invalid' }
  if (url.username !== '' || url.password !== '') return { kind: 'invalid' }
  return classifyHostname(url.hostname)
}

/**
 * An owner-typed host for the allow list, normalized like `urlHost` does, or null when it is not a
 * bare host name (a port, scheme, path, credentials, wildcard or IP literal is refused).
 */
export function normalizeHost(raw: string): string | null {
  if (raw === '' || /[\s:/@*?#[\]\\%]/.test(raw)) return null
  let url: URL
  try {
    url = new URL(`http://${raw}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/\.+$/, '')
  if (host === '' || isIPv4(host)) return null
  return host
}
