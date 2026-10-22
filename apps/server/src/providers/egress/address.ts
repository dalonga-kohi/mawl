import { BlockList, isIPv4, isIPv6 } from 'node:net'

/**
 * Where an address points, for outbound requests to owner-supplied urls (SSRF guard):
 * - `blocked`: never reachable (cloud metadata, link-local, unspecified, multicast, reserved).
 * - `private`: this machine or the owner's network; reachable only with an explicit opt-in
 *   (Ollama on the LAN) or for a provider's own default url (Ollama on localhost).
 * - `public`: anything else.
 */
export type AddressClass = 'blocked' | 'private' | 'public'

function list(entries: readonly [string, number][], type: 'ipv4' | 'ipv6'): BlockList {
  const out = new BlockList()
  for (const [network, prefix] of entries) out.addSubnet(network, prefix, type)
  return out
}

const BLOCKED_V4 = list(
  [
    ['0.0.0.0', 8], // "this network"; 0.0.0.0 reaches loopback
    ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
    ['100.100.100.200', 32], // Alibaba Cloud metadata, inside CGNAT space
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, broadcast
  ],
  'ipv4',
)
const PRIVATE_V4 = list(
  [
    ['127.0.0.0', 8], // loopback
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10], // CGNAT, Tailscale
  ],
  'ipv4',
)
const BLOCKED_V6 = list(
  [
    ['::', 128], // unspecified
    ['fe80::', 10], // link-local
    ['fd00:ec2::', 32], // AWS instance metadata over IPv6
    ['ff00::', 8], // multicast
  ],
  'ipv6',
)
const PRIVATE_V6 = list(
  [
    ['::1', 128], // loopback
    ['fc00::', 7], // unique local
  ],
  'ipv6',
)

/** The IPv4 address embedded in an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d) one. */
function embeddedV4(ip: string): string | undefined {
  // The URL parser prints IPv6 in one canonical form, dotted tails as two hex groups.
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1)
  // A zero high group still prints (`::ffff:0:1`), so there are always two groups.
  const match = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical)
  if (!match) return undefined
  const high = Number.parseInt(match[1] as string, 16)
  const low = Number.parseInt(match[2] as string, 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/** Classifies an IP literal (no brackets). Anything that is not one is `blocked`. */
export function classifyAddress(ip: string): AddressClass {
  if (isIPv4(ip)) {
    if (BLOCKED_V4.check(ip, 'ipv4')) return 'blocked'
    return PRIVATE_V4.check(ip, 'ipv4') ? 'private' : 'public'
  }
  if (!isIPv6(ip)) return 'blocked'
  const v4 = embeddedV4(ip)
  if (v4 !== undefined) return classifyAddress(v4)
  if (BLOCKED_V6.check(ip, 'ipv6')) return 'blocked'
  return PRIVATE_V6.check(ip, 'ipv6') ? 'private' : 'public'
}
