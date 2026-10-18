import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import type { ProviderTestResult } from '@faire/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import { __resetClaudeLoginCache, createClaudeCodeModel } from './model.ts'
import { type FakeQuery, fakeQuery, msg } from './test-util.ts'

afterEach(() => vi.unstubAllEnvs())

const userPrompt = (text: string): LanguageModelV4CallOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text', text }] }],
})

const happy = () => [
  msg.start(),
  msg.blockStart(0),
  msg.textDelta(0, 'Hel'),
  msg.textDelta(0, 'lo'),
  msg.blockStop(0),
  msg.success(),
]

beforeEach(() => __resetClaudeLoginCache())

const okLogin = async (): Promise<ProviderTestResult> => ({ ok: true, latencyMs: 1 })

function model(fq: FakeQuery, extra: Partial<Parameters<typeof createClaudeCodeModel>[0]> = {}) {
  return createClaudeCodeModel({
    modelId: 'sonnet',
    query: fq.query,
    checkLogin: okLogin,
    ...extra,
  })
}

async function readAll(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const parts: LanguageModelV4StreamPart[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

describe('Claude Code language model: query options', () => {
  it('always runs with no tools, no setting sources, no session, one turn and partial messages', async () => {
    const fq = fakeQuery(happy())
    const { stream } = await model(fq).doStream(userPrompt('hi'))
    await readAll(stream)
    expect(fq.calls).toHaveLength(1)
    const { options } = fq.calls[0] ?? { options: undefined }
    expect(options).toMatchObject({
      model: 'sonnet',
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      includePartialMessages: true,
      strictMcpConfig: true,
      permissionMode: 'dontAsk',
    })
  })

  it('never bypasses permissions or allows anything', async () => {
    const fq = fakeQuery(happy())
    await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    const options = fq.calls[0]?.options ?? {}
    expect(options).not.toHaveProperty('allowDangerouslySkipPermissions')
    expect(options).not.toHaveProperty('allowedTools')
    expect(options.permissionMode).not.toBe('bypassPermissions')
  })

  it('runs in a dedicated work dir, not the server working directory', async () => {
    const fq = fakeQuery(happy())
    await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    const cwd = fq.calls[0]?.options.cwd
    expect(cwd).toBeTypeOf('string')
    expect(cwd).not.toBe(process.cwd())
    expect(cwd).toContain('faire-claude-code')
  })

  it('defaults to one private per-process temp dir shared by every call', async () => {
    const a = fakeQuery(happy())
    const b = fakeQuery(happy())
    const first = model(a)
    const second = model(b)
    await Promise.all([
      first.doStream(userPrompt('hi')).then((r) => readAll(r.stream)),
      first.doStream(userPrompt('hi')).then((r) => readAll(r.stream)),
    ])
    await readAll((await second.doStream(userPrompt('hi'))).stream)
    const dirs = new Set([...a.calls, ...b.calls].map((c) => c.options.cwd))
    expect(dirs.size).toBe(1)
    const [dir] = [...dirs]
    expect(dir?.startsWith(join(tmpdir(), 'faire-claude-code-'))).toBe(true)
    expect(dir).not.toBe(join(tmpdir(), 'faire-claude-code'))
  })

  it('uses an injected work dir as given', async () => {
    const fq = fakeQuery(happy())
    const dir = join(tmpdir(), 'faire-injected-test-dir')
    await readAll((await model(fq, { workDir: dir }).doStream(userPrompt('hi'))).stream)
    expect(fq.calls[0]?.options.cwd).toBe(dir)
  })

  it('hands the binary a clean env even when the server env holds Anthropic credentials', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-x')
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const fq = fakeQuery(happy())
    await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    const env = fq.calls[0]?.options.env ?? {}
    expect(Object.keys(env).filter((k) => /ANTHROPIC|CLAUDE_CODE/i.test(k))).toEqual([])
  })

  it('passes the configured config dir and binary path, and omits the path when unset', async () => {
    const fq = fakeQuery(happy())
    await readAll(
      (
        await model(fq, {
          configDir: '/data/claude',
          pathToClaudeCodeExecutable: '/opt/claude',
        }).doStream(userPrompt('hi'))
      ).stream,
    )
    expect(fq.calls[0]?.options.env?.CLAUDE_CONFIG_DIR).toBe('/data/claude')
    expect(fq.calls[0]?.options.pathToClaudeCodeExecutable).toBe('/opt/claude')

    const plain = fakeQuery(happy())
    await readAll((await model(plain).doStream(userPrompt('hi'))).stream)
    expect(plain.calls[0]?.options).not.toHaveProperty('pathToClaudeCodeExecutable')
  })
})

describe('Claude Code language model: prompt', () => {
  it('sends system messages as the system prompt and a lone user message as the prompt', async () => {
    const fq = fakeQuery(happy())
    await readAll(
      (
        await model(fq).doStream({
          prompt: [
            { role: 'system', content: 'Be brief.' },
            { role: 'system', content: 'Answer in French.' },
            { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          ],
        })
      ).stream,
    )
    expect(fq.calls[0]?.options.systemPrompt).toBe('Be brief.\n\nAnswer in French.')
    expect(fq.calls[0]?.prompt).toBe('Hello')
  })

  it('leaves the system prompt unset when there is none', async () => {
    const fq = fakeQuery(happy())
    await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(fq.calls[0]?.options).not.toHaveProperty('systemPrompt')
  })

  it('renders earlier turns as a labelled transcript ending on the last user message', async () => {
    const fq = fakeQuery(happy())
    await readAll(
      (
        await model(fq).doStream({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: 'Q1' }] },
            {
              role: 'assistant',
              content: [
                { type: 'reasoning', text: 'hidden thoughts' },
                { type: 'text', text: 'A1' },
              ],
            },
            { role: 'user', content: [{ type: 'text', text: 'Q2' }] },
          ],
        })
      ).stream,
    )
    expect(fq.calls[0]?.prompt).toBe('User: Q1\n\nAssistant: A1\n\nUser: Q2')
  })

  it('rejects files and tool traffic, which the text-only adapter cannot carry', async () => {
    const fq = fakeQuery(happy())
    const file = model(fq).doStream({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'data', data: new Uint8Array([1]) },
            },
          ],
        },
      ],
    })
    await expect(file).rejects.toBeInstanceOf(UnsupportedFunctionalityError)
    const tool = model(fq).doStream({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'x' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: '1', toolName: 'f', input: {} }],
        },
      ],
    })
    await expect(tool).rejects.toBeInstanceOf(UnsupportedFunctionalityError)
    expect(fq.calls).toHaveLength(0)
  })

  it('rejects function tools before spawning anything', async () => {
    const fq = fakeQuery(happy())
    const call = {
      ...userPrompt('hi'),
      tools: [{ type: 'function' as const, name: 'f', description: 'd', inputSchema: {} }],
    }
    await expect(model(fq).doStream(call)).rejects.toBeInstanceOf(UnsupportedFunctionalityError)
    await expect(model(fq).doGenerate(call)).rejects.toBeInstanceOf(UnsupportedFunctionalityError)
    expect(fq.calls).toHaveLength(0)
  })

  it('accepts an empty tools list', async () => {
    const fq = fakeQuery(happy())
    const res = await model(fq).doGenerate({ ...userPrompt('hi'), tools: [] })
    expect(res.content).toEqual([{ type: 'text', text: 'Hello' }])
  })
})

describe('Claude Code language model: streaming', () => {
  it('maps text deltas, finish and usage', async () => {
    const fq = fakeQuery(happy())
    const { stream } = await model(fq).doStream(userPrompt('hi'))
    const parts = await readAll(stream)
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'response-metadata',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ])
    expect(parts.filter((p) => p.type === 'text-delta').map((p) => p.delta)).toEqual(['Hel', 'lo'])
    expect(parts.find((p) => p.type === 'response-metadata')).toMatchObject({
      id: 'msg_1',
      modelId: 'claude-sonnet-test',
    })
    const finish = parts.at(-1)
    expect(finish).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: 130, noCache: 10, cacheRead: 100, cacheWrite: 20 },
        outputTokens: { total: 5 },
      },
    })
  })

  it('maps thinking blocks to reasoning parts', async () => {
    const fq = fakeQuery([
      msg.blockStart(0, 'thinking'),
      msg.thinkingDelta(0, 'hmm'),
      msg.blockStop(0),
      msg.blockStart(1),
      msg.textDelta(1, 'ok'),
      msg.blockStop(1),
      msg.success(),
    ])
    const parts = await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
  })

  it.each([
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    [null, 'stop'],
    ['max_tokens', 'length'],
    ['refusal', 'content-filter'],
    ['pause_turn', 'other'],
  ])('maps stop reason %s to %s', async (stop, unified) => {
    const fq = fakeQuery([msg.success({ stop_reason: stop })])
    const parts = await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(parts.at(-1)).toMatchObject({ type: 'finish', finishReason: { unified } })
  })

  it('falls back to whole assistant messages when no partial events arrive', async () => {
    const fq = fakeQuery([msg.assistant('Whole answer'), msg.success()])
    const parts = await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(parts.filter((p) => p.type === 'text-delta').map((p) => p.delta)).toEqual([
      'Whole answer',
    ])
  })

  it('does not repeat text when the assistant message follows its partial events', async () => {
    const fq = fakeQuery([...happy().slice(0, -1), msg.assistant('Hello'), msg.success()])
    const parts = await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(parts.filter((p) => p.type === 'text-delta').map((p) => p.delta)).toEqual(['Hel', 'lo'])
  })

  it('ignores a warning-level rate limit event and unknown messages', async () => {
    const fq = fakeQuery([
      { type: 'system', subtype: 'init' },
      msg.rateLimit('allowed_warning'),
      { type: 'something_new' },
      ...happy(),
    ])
    const parts = await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(parts.at(-1)?.type).toBe('finish')
  })

  it('closes the query when the stream ends', async () => {
    const fq = fakeQuery(happy())
    await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    expect(fq.closed()).toBeGreaterThanOrEqual(1)
  })
})

describe('Claude Code language model: doGenerate', () => {
  it('collects the stream into content, usage and finish reason', async () => {
    const fq = fakeQuery([
      msg.blockStart(0, 'thinking'),
      msg.thinkingDelta(0, 'hmm'),
      msg.blockStop(0),
      ...happy(),
    ])
    const res = await model(fq).doGenerate(userPrompt('hi'))
    expect(res.content).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'text', text: 'Hello' },
    ])
    expect(res.finishReason).toEqual({ unified: 'stop', raw: 'end_turn' })
    expect(res.usage.inputTokens.total).toBe(130)
    expect(res.usage.outputTokens.total).toBe(5)
  })
})

describe('Claude Code language model: abort', () => {
  it('aborts the query when the AI SDK signal aborts mid-stream', async () => {
    const fq = fakeQuery([msg.blockStart(0), msg.textDelta(0, 'a')], { hang: true })
    const controller = new AbortController()
    const { stream } = await model(fq).doStream({
      ...userPrompt('hi'),
      abortSignal: controller.signal,
    })
    const reader = stream.getReader()
    await reader.read() // stream-start
    controller.abort()
    expect(fq.calls[0]?.options.abortController?.signal.aborted).toBe(true)
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) return
      })(),
    ).rejects.toBeDefined()
  })

  it('aborts the query when the consumer cancels the stream', async () => {
    const fq = fakeQuery([msg.blockStart(0)], { hang: true })
    const { stream } = await model(fq).doStream(userPrompt('hi'))
    await stream.cancel()
    expect(fq.calls[0]?.options.abortController?.signal.aborted).toBe(true)
    expect(fq.closed()).toBeGreaterThanOrEqual(1)
  })

  it('starts aborted when the signal was already aborted', async () => {
    const fq = fakeQuery(happy())
    const controller = new AbortController()
    controller.abort()
    const res = model(fq).doGenerate({ ...userPrompt('hi'), abortSignal: controller.signal })
    await expect(res).rejects.toBeDefined()
    expect(fq.calls[0]?.options.abortController?.signal.aborted).toBe(true)
  })
})

describe('Claude Code language model: failures', () => {
  async function failureOf(messages: unknown[], opts?: { throwAfter?: unknown }) {
    const fq = fakeQuery(messages, opts)
    const err: unknown = await model(fq, { now: () => 1_800_000_000_000 })
      .doGenerate(userPrompt('hi'))
      .then(
        () => undefined,
        (e: unknown) => e,
      )
    expect(err).toBeInstanceOf(ProviderFailureError)
    return err as ProviderFailureError
  }

  it('maps a rejected rate limit event to plan_limit_reached with the wait', async () => {
    const err = await failureOf([msg.rateLimit('rejected', 1_800_000_120)])
    expect(err.reason).toBe('plan_limit_reached')
    expect(err.retryAfter).toBe(120)
  })

  it.each([
    ['rate_limit', 'plan_limit_reached'],
    ['authentication_failed', 'reauth_required'],
    ['oauth_org_not_allowed', 'reauth_required'],
    ['verification_required', 'reauth_required'],
    ['account_on_hold', 'not_eligible'],
    ['billing_error', 'not_eligible'],
    ['overloaded', 'temporarily_unavailable'],
    ['server_error', 'temporarily_unavailable'],
    ['model_not_found', 'config_error'],
    ['invalid_request', 'config_error'],
    ['unknown', 'provider_error'],
  ])('maps assistant error %s to %s', async (code, reason) => {
    const err = await failureOf([msg.assistant('Not logged in sk-ant-LEAK', code), msg.failure()])
    expect(err.reason).toBe(reason)
  })

  it('maps error results and error-flagged success results to provider_error', async () => {
    expect((await failureOf([msg.failure('error_max_turns')])).reason).toBe('provider_error')
    expect((await failureOf([msg.success({ is_error: true })])).reason).toBe('provider_error')
  })

  it('maps a crash of the query itself to provider_error without its text', async () => {
    const err = await failureOf([], { throwAfter: new Error('spawn failed: token sk-ant-LEAK') })
    expect(err.reason).toBe('provider_error')
    expect(JSON.stringify(err)).not.toContain('LEAK')
    expect(err.message).not.toContain('LEAK')
  })

  it('never lets SDK error text reach the thrown error', async () => {
    const err = await failureOf([
      msg.assistant('Invalid API key sk-ant-LEAK', 'authentication_failed'),
    ])
    expect(err.message).toBe('Provider failure: reauth_required')
    expect(String(err.cause ?? '')).not.toContain('LEAK')
  })

  it('reports a failure in a stream as an error part, then finishes with reason error', async () => {
    const fq = fakeQuery([msg.assistant('x sk-ant-LEAK', 'authentication_failed')])
    const parts = await readAll((await model(fq).doStream(userPrompt('hi'))).stream)
    const error = parts.find((p) => p.type === 'error')
    expect(error?.error).toBeInstanceOf(ProviderFailureError)
    expect(parts.at(-1)).toMatchObject({ type: 'finish', finishReason: { unified: 'error' } })
    expect(JSON.stringify(parts)).not.toContain('LEAK')
  })
})

describe('Claude Code language model: login check', () => {
  const fail = (reason: Extract<ProviderTestResult, { ok: false }>['reason']) =>
    vi.fn(async (): Promise<ProviderTestResult> => ({ ok: false, reason }))

  it('never starts a query when the binary uses another auth method', async () => {
    const fq = fakeQuery(happy())
    const checkLogin = fail('wrong_auth_method')
    const m = model(fq, { checkLogin })
    const err = await m.doGenerate(userPrompt('hi')).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect((err as ProviderFailureError).reason).toBe('config_error')
    const parts = await readAll((await m.doStream(userPrompt('hi'))).stream)
    expect(fq.calls).toHaveLength(0)
    expect(parts.map((p) => p.type)).toEqual(['stream-start', 'error', 'finish'])
    expect(parts.find((p) => p.type === 'error')?.error).toMatchObject({ reason: 'config_error' })
    expect(parts.at(-1)).toMatchObject({ finishReason: { unified: 'error', raw: 'config_error' } })
  })

  it.each([
    ['not_signed_in', 'reauth_required'],
    ['wrong_auth_method', 'config_error'],
    ['unreachable', 'provider_error'],
    ['unexpected_response', 'provider_error'],
  ] as const)('maps a %s login check to %s', async (reason, expected) => {
    const fq = fakeQuery(happy())
    const err = await model(fq, { checkLogin: fail(reason) })
      .doGenerate(userPrompt('hi'))
      .then(
        () => undefined,
        (e: unknown) => e,
      )
    expect((err as ProviderFailureError).reason).toBe(expected)
    expect(fq.calls).toHaveLength(0)
  })

  it('still rejects unsupported input before running the login check', async () => {
    const checkLogin = vi.fn(okLogin)
    const call = {
      ...userPrompt('hi'),
      tools: [{ type: 'function' as const, name: 'f', description: 'd', inputSchema: {} }],
    }
    await expect(model(fakeQuery(happy()), { checkLogin }).doStream(call)).rejects.toBeInstanceOf(
      UnsupportedFunctionalityError,
    )
    expect(checkLogin).not.toHaveBeenCalled()
  })

  it('caches an ok result for five minutes, across models, then checks again', async () => {
    let t = 1_000_000
    const checkLogin = vi.fn(okLogin)
    const make = () => model(fakeQuery(happy()), { checkLogin, now: () => t })
    await make().doGenerate(userPrompt('hi'))
    await make().doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(1)
    t += 5 * 60_000 - 1
    await make().doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(1)
    t += 1
    await make().doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    const checkLogin = vi
      .fn<() => Promise<ProviderTestResult>>()
      .mockResolvedValueOnce({ ok: false, reason: 'not_signed_in' })
      .mockResolvedValue({ ok: true, latencyMs: 1 })
    const m = model(fakeQuery(happy()), { checkLogin })
    await expect(m.doGenerate(userPrompt('hi'))).rejects.toBeInstanceOf(ProviderFailureError)
    await m.doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight check between concurrent calls', async () => {
    let release: (r: ProviderTestResult) => void = () => {}
    const checkLogin = vi.fn(
      () =>
        new Promise<ProviderTestResult>((resolve) => {
          release = resolve
        }),
    )
    const m = model(fakeQuery(happy()), { checkLogin })
    const a = m.doGenerate(userPrompt('hi'))
    const b = m.doGenerate(userPrompt('hi'))
    await vi.waitFor(() => expect(checkLogin).toHaveBeenCalledTimes(1))
    release({ ok: true, latencyMs: 1 })
    await Promise.all([a, b])
    expect(checkLogin).toHaveBeenCalledTimes(1)
  })

  it('keeps separate results per binary path and config dir', async () => {
    const checkLogin = vi.fn(okLogin)
    await model(fakeQuery(happy()), { checkLogin, configDir: '/a' }).doGenerate(userPrompt('hi'))
    await model(fakeQuery(happy()), { checkLogin, configDir: '/b' }).doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(2)
  })
})
