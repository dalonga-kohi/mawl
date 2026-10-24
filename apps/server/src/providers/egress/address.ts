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
    ['168.63.129.16', 32], // Azure wire server (metadata and agent channel)
    ['192.0.2.0', 24], // documentation (TEST-NET-1)
    ['198.51.100.0', 24], // documentation (TEST-NET-2)
    ['203.0.113.0', 24], // documentation (TEST-NET-3)
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
    ['192.0.0.0', 24], // IETF protocol assignments
    ['198.18.0.0', 15], // benchmarking
  ],
  'ipv4',
)
const BLOCKED_V6 = list(
  [
    ['::', 128], // unspecified
    ['fe80::', 10], // link-local
    ['fd00:ec2::', 32], // AWS instance metadata over IPv6
    ['ff00::', 8], // multicast
    // Tunnels that carry an IPv4 we cannot vet: 6to4, Teredo, local-use NAT64.
    ['2002::', 16],
    ['2001::', 32],
    ['64:ff9b:1::', 48],
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

/** The eight 16-bit groups of a valid IPv6 literal (dotted tail and `::` expanded). */
function groupsOf(ip: string): number[] {
  // The URL parser prints IPv6 in one canonical form, with a dotted tail as two hex groups.
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1)
  const [head = '', tail] = canonical.split('::')
  const parse = (part: string) =>
    part === '' ? [] : part.split(':').map((g) => Number.parseInt(g, 16))
  const left = parse(head)
  if (tail === undefined) return left
  const right = parse(tail)
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right]
}

/**
 * The IPv4 address in the low 32 bits of an IPv4-mapped (::ffff:0:0/96), IPv4-translated
 * (::ffff:0:0:0/96), NAT64 (64:ff9b::/96) or IPv4-compatible (::/96, deprecated) address, matched
 * by prefix on the numeric groups so every spelling (`64:ff9b::7f`, dotted or hex) is caught.
 * `::` and `::1` are not compatible addresses.
 */
function embeddedV4(ip: string): string | undefined {
  const g = groupsOf(ip)
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)
  const mapped = zero(0, 5) && g[5] === 0xffff
  const translated = zero(0, 4) && g[4] === 0xffff && g[5] === 0
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)
  const compatible = zero(0, 6) && !(g[6] === 0 && (g[7] === 0 || g[7] === 1))
  if (!(mapped || translated || nat64 || compatible)) return undefined
  const high = g[6] ?? 0
  const low = g[7] ?? 0
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/** Classifies an IP literal (no brackets). Anything that is not one is `blocked`. */
export function classifyAddress(ip: string): AddressClass {
  // A zone id (`fe80::1%2`) picks an interface; never allowed for an outbound request.
  if (ip.includes('%')) return 'blocked'
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
