import { describe, expect, it } from 'vitest'
import { classifyAddress } from './address.ts'

describe('classifyAddress', () => {
  it.each([
    // Cloud metadata and link-local: never reachable, not even with the private opt-in.
    '169.254.169.254',
    '169.254.0.1',
    '169.254.255.255',
    'fd00:ec2::254',
    'fd00:ec2:0:1::1',
    'fe80::1',
    'febf:ffff::1',
    // Unspecified ("this host"): connects to loopback on most systems.
    '0.0.0.0',
    '0.1.2.3',
    '::',
    // Multicast, broadcast and reserved.
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    '240.0.0.1',
    'ff02::1',
    // Alibaba Cloud metadata sits inside CGNAT space.
    '100.100.100.200',
    // The same addresses wearing IPv6 clothes.
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:0.0.0.0',
    '::ffff:0.0.0.1',
    '64:ff9b::169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    // IPv4-compatible (deprecated ::a.b.c.d) forms read as their IPv4 too.
    '::169.254.169.254',
    '::a9fe:a9fe',
    '::0.0.0.2',
    // Tunnels that embed an IPv4 we would not see: 6to4, Teredo, local-use NAT64.
    '2002:a9fe:a9fe::1',
    '2002:c0a8:101::1',
    '2001:0:4136:e378::1',
    '2001::1',
    '64:ff9b:1::a9fe:a9fe',
    // Documentation ranges: never a real provider.
    '192.0.2.10',
    '198.51.100.7',
    '203.0.113.200',
    // Azure's wire server (metadata and agent channel).
    '168.63.129.16',
  ])('blocks %s', (ip) => {
    expect(classifyAddress(ip)).toBe('blocked')
  })

  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '100.64.0.1',
    '100.127.255.255',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    // Unique local, but outside AWS's fd00:ec2::/32.
    'fd00:ec3::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:192.168.1.20',
    '64:ff9b::10.0.0.1',
    '::10.0.0.1',
    // IETF protocol assignments and the benchmarking range: not public, not metadata.
    '192.0.0.1',
    '198.18.0.1',
    '198.19.255.255',
  ])('marks %s private (needs the owner opt-in)', (ip) => {
    expect(classifyAddress(ip)).toBe('private')
  })

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::8.8.8.8',
    '::8.8.8.8',
    '192.0.1.255',
    '198.17.255.255',
    '198.20.0.0',
    '168.63.129.17',
    '2001:db9::1',
  ])('marks %s public', (ip) => {
    expect(classifyAddress(ip)).toBe('public')
  })

  it.each(['', 'localhost', 'example.com', '1.2.3', '256.1.1.1', '::g', '[::1]'])(
    'blocks %j, which is not an IP address',
    (value) => {
      expect(classifyAddress(value)).toBe('blocked')
    },
  )
})
