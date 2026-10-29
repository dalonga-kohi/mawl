import { newId } from '@mawl/contracts'
import { allowAllGate, createToolRegistry, type ToolLedger, webFetchTool } from '@mawl/core'
import { describe, expect, it, vi } from 'vitest'
import type { PinnedTransport, ResolveHost } from '../providers/egress/guarded-fetch.ts'
import { guardedWebFetch } from './registry.ts'

const runId = newId('run')
const profileId = newId('profile')

function ledger(): ToolLedger {
  const results = new Map<string, Awaited<ReturnType<ToolLedger['recordToolResult']>>>()
  return {
    toolResult: async (_r, k) => results.get(k.toolCallId) ?? null,
    recordToolCall: async () => {},
    recordToolResult: async (_r, k, record) => {
      results.set(k.toolCallId, record)
      return record
    },
  }
}

/** `dns` maps a host to one or more addresses. */
function fetchVia(dns: Record<string, string | string[]>, transport: PinnedTransport) {
  const resolve: ResolveHost = async (host) => {
    const v = dns[host]
    const list = v === undefined ? [] : Array.isArray(v) ? v : [v]
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
  const run = createToolRegistry({
    gate: allowAllGate,
    tools: [webFetchTool({ fetch: guardedWebFetch({ resolve, transport }) })],
  }).forRun({ runId, profileId })
  return async (url: string) => {
    const r = await run.invoke(
      { stepIdx: 0, toolCallId: 'c1', toolName: 'web_fetch', input: { url } },
      { ledger: ledger(), signal: new AbortController().signal, allowPark: true },
    )
    if (r.kind !== 'result') throw new Error('expected a result')
    return r.part.output.type === 'text' || r.part.output.type === 'error-text'
      ? r.part.output.value
      : ''
  }
}

const page = () => new Response('<p>public page</p>', { headers: { 'content-type': 'text/html' } })

describe('web_fetch egress: odd ways to spell an internal address', () => {
  it.each([
    ['decimal integer loopback', 'http://2130706433/'],
    ['hex loopback', 'http://0x7f000001/'],
    ['octal loopback', 'http://0177.0.0.1/'],
    ['short dotted loopback', 'http://127.1/'],
    ['all zeros', 'http://0.0.0.0/'],
    ['zero shorthand', 'http://0/'],
    ['IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped IPv6 hex form', 'http://[::ffff:7f00:1]/'],
    ['IPv4-mapped metadata address', 'http://[::ffff:169.254.169.254]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv6 unique local', 'http://[fd00::1]/'],
    ['IPv6 unspecified', 'http://[::]/'],
    ['carrier-grade NAT', 'http://100.64.0.1/'],
    ['172.16 private block edge', 'http://172.31.255.255/'],
    ['192.168 block', 'http://192.168.0.1/'],
    ['link-local range start', 'http://169.254.0.1/'],
    ['trailing-dot localhost', 'http://localhost./'],
    ['localhost name', 'http://localhost/'],
    ['userinfo trick is refused by shape', 'http://example.com@127.0.0.1/'],
  ])('refuses %s without connecting', async (_label, url) => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    const out = await fetchVia(
      { localhost: '127.0.0.1', 'localhost.': '127.0.0.1' },
      transport,
    )(url)
    expect(out).toMatch(/blocked_address|invalid_url|unreachable/)
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([
    ['IPv4-mapped private', '::ffff:10.0.0.1'],
    ['IPv4-mapped private hex', '::ffff:a00:1'],
    ['NAT64 of loopback', '64:ff9b::7f00:1'],
    ['IPv6 unique local', 'fc00::1'],
    ['link-local', 'fe80::abcd'],
    ['loopback', '127.0.0.2'],
  ])('refuses a name whose DNS answer is %s', async (_label, address) => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    const out = await fetchVia({ 'evil.example': address }, transport)('https://evil.example/')
    expect(out).toContain('blocked_address')
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses a name when ANY of its answers is internal (mixed public and private)', async () => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    const out = await fetchVia(
      { 'mixed.example': ['93.184.216.34', '10.0.0.9'] },
      transport,
    )('https://mixed.example/')
    expect(out).toContain('blocked_address')
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses a name that does not resolve at all, without connecting', async () => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    const out = await fetchVia({}, transport)('https://nowhere.example/')
    expect(out).toMatch(/blocked_address|unreachable/)
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('web_fetch egress: redirect chains', () => {
  const hop = (location: string) => new Response(null, { status: 302, headers: { location } })

  it.each([
    ['loopback literal', 'http://127.0.0.1:8080/'],
    ['decimal loopback', 'http://2130706433/'],
    ['mapped IPv6', 'http://[::ffff:10.0.0.1]/'],
    ['metadata', 'http://169.254.169.254/latest'],
    ['link-local IPv6', 'http://[fe80::1]/'],
    ['relative to a private-named host', '//internal.example/x'],
  ])('refuses a redirect to %s after a public first hop', async (_l, location) => {
    const transport = vi.fn<PinnedTransport>(async (url) =>
      url.hostname === 'example.com' ? hop(location) : page(),
    )
    const out = await fetchVia(
      { 'example.com': '93.184.216.34', 'internal.example': '10.1.2.3' },
      transport,
    )('https://example.com/')
    expect(out).toContain('blocked_address')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/x'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,<p>x</p>'],
    ['credentials', 'http://user:pw@example.com/'],
  ])('refuses a redirect to a %s url without requesting it', async (_l, location) => {
    const transport = vi.fn<PinnedTransport>(async () => hop(location))
    const out = await fetchVia(
      { 'example.com': '93.184.216.34' },
      transport,
    )('https://example.com/')
    expect(out).toContain('invalid_url')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('catches a rebinding hop: the same name answers a private address on the second request', async () => {
    let answers = 0
    const resolve: ResolveHost = async () => {
      answers++
      return [{ address: answers === 1 ? '93.184.216.34' : '10.0.0.1', family: 4 }]
    }
    const transport = vi.fn<PinnedTransport>(async () => hop('https://rebind.example/second'))
    const run = createToolRegistry({
      gate: allowAllGate,
      tools: [webFetchTool({ fetch: guardedWebFetch({ resolve, transport }) })],
    }).forRun({ runId, profileId })
    const r = await run.invoke(
      {
        stepIdx: 0,
        toolCallId: 'c1',
        toolName: 'web_fetch',
        input: { url: 'https://rebind.example/' },
      },
      { ledger: ledger(), signal: new AbortController().signal, allowPark: true },
    )
    expect(
      r.kind === 'result' && r.part.output.type === 'error-text' && r.part.output.value,
    ).toContain('blocked_address')
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
