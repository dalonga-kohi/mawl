import { newId } from '@mawl/contracts'
import { allowAllGate, createToolRegistry, type ToolLedger, webFetchTool } from '@mawl/core'
import { describe, expect, it, vi } from 'vitest'
import type { PinnedTransport, ResolveHost } from '../providers/egress/guarded-fetch.ts'
import { guardedWebFetch } from './registry.ts'

const runId = newId('run')
const profileId = newId('profile')

/** Enough of a ledger for one call: nothing recorded before, results kept in memory. */
function ledger(): ToolLedger {
  const results = new Map<string, Awaited<ReturnType<ToolLedger['recordToolResult']>>>()
  return {
    toolResult: async (_r, k) => results.get(k.toolCallId) ?? null,
    recordToolCall: async () => {},
    approvedCall: async () => null,
    recordToolResult: async (_r, k, record) => {
      results.set(k.toolCallId, record)
      return record
    },
  }
}

function fetchVia(dns: Record<string, string>, transport: PinnedTransport) {
  const resolve: ResolveHost = async (host) => {
    const address = dns[host]
    return address ? [{ address, family: address.includes(':') ? 6 : 4 }] : []
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

describe('web_fetch through the server egress guard', () => {
  it('fetches a public address', async () => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    const out = await fetchVia(
      { 'example.com': '93.184.216.34' },
      transport,
    )('https://example.com/')
    expect(out).toContain('public page')
    expect(transport.mock.calls[0]?.[2]).toBe('93.184.216.34')
  })

  it.each([
    ['the metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['loopback', 'http://127.0.0.1:5432/'],
    ['a private network', 'http://10.0.0.5/'],
    ['IPv6 loopback', 'http://[::1]/'],
  ])('refuses %s without connecting', async (_label, url) => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    expect(await fetchVia({}, transport)(url)).toContain('blocked_address')
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses a name that resolves to a private address (DNS pointing inside)', async () => {
    const transport = vi.fn<PinnedTransport>(async () => page())
    expect(
      await fetchVia({ 'evil.example': '192.168.1.1' }, transport)('https://evil.example/'),
    ).toContain('blocked_address')
    expect(transport).not.toHaveBeenCalled()
  })

  it('re-checks a redirect hop and refuses one that points inside', async () => {
    const transport = vi.fn<PinnedTransport>(async (url) =>
      url.hostname === 'example.com'
        ? new Response(null, {
            status: 302,
            headers: { location: 'http://internal.example/admin' },
          })
        : page(),
    )
    const out = await fetchVia(
      { 'example.com': '93.184.216.34', 'internal.example': '10.1.2.3' },
      transport,
    )('https://example.com/')
    expect(out).toContain('blocked_address')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0]?.[1].redirect).toBe('manual')
  })
})
