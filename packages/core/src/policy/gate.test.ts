import { type ActionClass, newId, type ProfileId, type RunId } from '@mawl/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { webFetchTool } from '../tools/builtin/web-fetch.ts'
import { defineTool } from '../tools/define.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { MemoryArtifacts, MemoryLedger } from '../tools/test-util.ts'
import type { Tool } from '../tools/types.ts'
import { hostsFromToolCalls, type PolicyGateDeps, policyGate } from './gate.ts'

const runId = newId('run')
const profileId = newId('profile')

function stub(name: string, actionClass: ActionClass, ran: string[]): Tool {
  return defineTool({
    name,
    description: name,
    inputSchema: z.strictObject({ command: z.string().optional() }),
    actionClass,
    run: async () => {
      ran.push(name)
      return { kind: 'ok', text: `${name} ran` }
    },
  })
}

function harness(deps: Partial<PolicyGateDeps> = {}) {
  const ran: string[] = []
  const fetch = vi.fn(
    async () => new Response('page', { headers: { 'content-type': 'text/plain' } }),
  )
  const gate = policyGate({
    load: async () => ({ policy: {}, trigger: 'user' }),
    seenHosts: async () => [],
    ...deps,
  })
  const ledger = new MemoryLedger()
  const tools = createToolRegistry({
    tools: [
      webFetchTool({ fetch }),
      stub('reader', 'read', ran),
      stub('writer', 'write_local', ran),
      stub('shell', 'shell_exec', ran),
      stub('mcp__mail__send', 'send_message', ran),
    ],
    artifacts: new MemoryArtifacts(),
    gate,
  }).forRun({ runId, profileId })
  let n = 0
  const call = async (toolName: string, input: unknown) => {
    const r = await tools.invoke(
      { stepIdx: 0, toolCallId: `c${++n}`, toolName, input },
      { ledger, signal: new AbortController().signal, allowPark: true },
    )
    if (r.kind !== 'result') throw new Error('expected a result')
    const o = r.part.output
    const text = o.type === 'text' || o.type === 'error-text' ? o.value : ''
    const event = ledger.events.filter((e) => e.type === 'run.tool_call').at(-1)?.payload
    return { denied: r.record.isError && text.includes('denied'), text, event }
  }
  return { call, fetch, ran, ledger }
}

describe('policyGate through the tool registry', () => {
  it('runs a read tool and records level and source', async () => {
    const h = harness()
    const r = await h.call('reader', {})
    expect(r.denied).toBe(false)
    expect(r.event).toMatchObject({ level: 'auto', source: 'global' })
    expect(r.event).not.toHaveProperty('mode')
  })

  it('denies a first web_fetch to a host (ask, until approvals exist) without fetching', async () => {
    const h = harness()
    const r = await h.call('web_fetch', { url: 'https://a.com/x?secret=1' })
    expect(r.denied).toBe(true)
    expect(r.text).toMatch(/approvals .*not available yet/i)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(r.event).toMatchObject({ level: 'ask', source: 'global' })
  })

  it('fetches a host already fetched in this run (read from the ledger, so it survives a resume)', async () => {
    const seenHosts = vi.fn(async () => ['a.com'])
    const h = harness({ seenHosts })
    const r = await h.call('web_fetch', { url: 'https://A.com./y' })
    expect(r.denied).toBe(false)
    expect(seenHosts).toHaveBeenCalledWith(runId)
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('fetches an allow-listed host', async () => {
    const h = harness({
      load: async () => ({ policy: { allowedHosts: ['a.com'] }, trigger: 'user' }),
    })
    expect((await h.call('web_fetch', { url: 'https://a.com/' })).denied).toBe(false)
  })

  it('blocks a loopback fetch even under Autopilot', async () => {
    const h = harness({ load: async () => ({ policy: { mode: 'autopilot' }, trigger: 'user' }) })
    const r = await h.call('web_fetch', { url: 'http://user@evil.com@127.0.0.1/' })
    expect(r.denied).toBe(true)
    expect(r.event).toMatchObject({ level: 'block', source: 'floor', mode: 'autopilot' })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('Autopilot runs a first fetch and a write, and the event says so', async () => {
    const h = harness({ load: async () => ({ policy: { mode: 'autopilot' }, trigger: 'user' }) })
    const f = await h.call('web_fetch', { url: 'https://a.com/' })
    expect(f.denied).toBe(false)
    expect(f.event).toMatchObject({ level: 'auto', source: 'autopilot', mode: 'autopilot' })
    const w = await h.call('writer', {})
    expect(w.denied).toBe(false)
    expect(h.ran).toEqual(['writer'])
  })

  it('a teammate-triggered run gets no Autopilot', async () => {
    const h = harness({
      load: async () => ({ policy: { mode: 'autopilot' }, trigger: 'teammate' }),
    })
    const w = await h.call('writer', {})
    expect(w.denied).toBe(true)
    expect(w.event).toMatchObject({ level: 'ask', source: 'global', mode: 'autopilot' })
    expect(h.ran).toEqual([])
  })

  it('matches a shell prefix rule against the full command, not the cut event copy', async () => {
    const rules = [{ match: { tool: 'shell', argPattern: 'git status' }, level: 'auto' }]
    const h = harness({ load: async () => ({ policy: { rules }, trigger: 'user' }) })
    expect((await h.call('shell', { command: 'git status -s' })).denied).toBe(false)
    const hidden = `git status ${'a'.repeat(300)}; Remove-Item -Recurse C:\\`
    const r = await h.call('shell', { command: hidden })
    expect(r.denied).toBe(true)
    expect(h.ran).toEqual(['shell'])
  })

  it('reads the MCP server from the namespaced tool name', async () => {
    const rules = [{ match: { mcpServer: 'mail' }, level: 'auto' }]
    const h = harness({ load: async () => ({ policy: { rules }, trigger: 'user' }) })
    expect((await h.call('mcp__mail__send', {})).denied).toBe(false)
  })

  it('falls back to the default policy on an invalid policy_json and reports it', async () => {
    const onInvalidPolicy = vi.fn()
    const h = harness({
      load: async () => ({ policy: { mode: 'autopilot', allowAll: true }, trigger: 'user' }),
      onInvalidPolicy,
    })
    const r = await h.call('writer', {})
    expect(r.denied).toBe(true)
    expect(r.event).not.toHaveProperty('mode')
    expect(onInvalidPolicy).toHaveBeenCalledWith(profileId)
  })

  it('fails closed when the policy cannot be loaded: defaults and the strict trigger', async () => {
    const onLoadError = vi.fn()
    const h = harness({
      load: async () => {
        throw new Error('db down')
      },
      onLoadError,
    })
    expect((await h.call('reader', {})).denied).toBe(false)
    expect((await h.call('writer', {})).denied).toBe(true)
    expect((await h.call('web_fetch', { url: 'https://a.com/' })).denied).toBe(true)
    expect(onLoadError).toHaveBeenCalled()
  })

  it('asks again when the seen hosts cannot be read, and reports the failure', async () => {
    const onLoadError = vi.fn()
    const err = new Error('db down')
    const h = harness({
      seenHosts: async () => {
        throw err
      },
      onLoadError,
    })
    expect((await h.call('web_fetch', { url: 'https://a.com/' })).denied).toBe(true)
    expect(onLoadError).toHaveBeenCalledWith(err)
  })

  it('reads the seen hosts only for web_fetch', async () => {
    const seenHosts = vi.fn(async () => [])
    const h = harness({ seenHosts })
    await h.call('reader', {})
    expect(seenHosts).not.toHaveBeenCalled()
  })

  it('hands the run and profile to the loader', async () => {
    const load = vi.fn(async (_r: { runId: RunId; profileId: ProfileId }) => ({
      policy: {},
      trigger: 'user' as const,
    }))
    const h = harness({ load })
    await h.call('reader', {})
    expect(load).toHaveBeenCalledWith({ runId, profileId })
  })
})

describe('hostsFromToolCalls', () => {
  it('keeps only hosts of allowed web_fetch calls', () => {
    const hosts = hostsFromToolCalls([
      { tool: 'web_fetch', level: 'auto', argsRedacted: { url: 'https://A.com:8443/p?…' } },
      { tool: 'web_fetch', level: 'auto', argsRedacted: { url: 'https://xn--bcher-kva.de/' } },
      { tool: 'web_fetch', level: 'ask', argsRedacted: { url: 'https://denied.com/' } },
      { tool: 'web_fetch', argsRedacted: { url: 'https://legacy.com/' } },
      { tool: 'web_search', level: 'auto', argsRedacted: { url: 'https://other.com/' } },
      { tool: 'web_fetch', level: 'auto', argsRedacted: { url: 'http://127.0.0.1/' } },
      { tool: 'web_fetch', level: 'auto', argsRedacted: { url: 42 } },
      { tool: 'web_fetch', level: 'auto', argsRedacted: null },
      null,
      'junk',
    ])
    expect(hosts).toEqual(['a.com', 'xn--bcher-kva.de'])
  })
})
