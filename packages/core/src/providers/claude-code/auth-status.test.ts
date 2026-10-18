import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBundledClaudeBinary, testClaudeCodeLogin } from './auth-status.ts'

afterEach(() => vi.unstubAllEnvs())

const status = (over: Record<string, unknown>) =>
  JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', ...over })

function runner(stdout: string) {
  const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = []
  const run = async (command: string, args: string[], o: { env: Record<string, string> }) => {
    calls.push({ command, args, env: o.env })
    return { stdout }
  }
  return { run, calls }
}

const base = { resolveBinary: () => '/opt/claude', now: () => 0 }

describe('testClaudeCodeLogin', () => {
  it('is ok for a claude.ai subscription login, with the measured latency', async () => {
    const r = runner(status({}))
    let t = 0
    const res = await testClaudeCodeLogin({
      ...base,
      run: r.run,
      now: () => (t += 42),
    })
    expect(res).toEqual({ ok: true, latencyMs: 42 })
    expect(r.calls[0]).toMatchObject({ command: '/opt/claude', args: ['auth', 'status'] })
  })

  it('says not signed in when there is no login', async () => {
    const r = runner(status({ loggedIn: false, authMethod: 'none' }))
    expect(await testClaudeCodeLogin({ ...base, run: r.run })).toEqual({
      ok: false,
      reason: 'not_signed_in',
    })
  })

  it.each(['api_key', 'oauth_token', 'api_key_helper', 'third_party', 'something_new'])(
    'refuses auth method %s: it would bill someone else’s key or token',
    async (authMethod) => {
      const r = runner(status({ authMethod }))
      expect(await testClaudeCodeLogin({ ...base, run: r.run })).toEqual({
        ok: false,
        reason: 'wrong_auth_method',
      })
    },
  )

  it('is unreachable when the binary cannot be found', async () => {
    const run = vi.fn()
    const res = await testClaudeCodeLogin({ ...base, resolveBinary: () => null, run })
    expect(res).toEqual({ ok: false, reason: 'unreachable' })
    expect(run).not.toHaveBeenCalled()
  })

  it('is unreachable when the binary fails to spawn, and never echoes the error text', async () => {
    const res = await testClaudeCodeLogin({
      ...base,
      run: async () => {
        throw new Error('spawn /opt/claude ENOENT sk-ant-LEAK')
      },
    })
    expect(res).toEqual({ ok: false, reason: 'unreachable' })
    expect(JSON.stringify(res)).not.toContain('LEAK')
  })

  it('is unreachable when the binary outlives the deadline, even if it ignores the signal', async () => {
    vi.useFakeTimers()
    try {
      const pending = testClaudeCodeLogin({
        ...base,
        timeoutMs: 10_000,
        run: () => new Promise(() => {}),
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toEqual({ ok: false, reason: 'unreachable' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats output that is not the expected JSON as an unexpected response, never echoing it', async () => {
    const r = runner('Logged in as secret@example.com sk-ant-LEAK')
    const res = await testClaudeCodeLogin({ ...base, run: r.run })
    expect(res).toEqual({ ok: false, reason: 'unexpected_response' })
    expect(JSON.stringify(res)).not.toContain('LEAK')
    expect((await testClaudeCodeLogin({ ...base, run: runner('{}').run })).ok).toBe(false)
  })

  it('never returns stdout text on success either: only ok and latency', async () => {
    const r = runner(status({ email: 'secret@example.com', orgName: 'Acme' }))
    const res = await testClaudeCodeLogin({ ...base, run: r.run })
    expect(Object.keys(res).sort()).toEqual(['latencyMs', 'ok'])
  })

  it('runs the binary with the clean env and the configured config dir', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-x')
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const r = runner(status({}))
    await testClaudeCodeLogin({ ...base, run: r.run, configDir: '/data/claude' })
    const env = r.calls[0]?.env ?? {}
    expect(Object.keys(env).filter((k) => /ANTHROPIC|CLAUDE_CODE/i.test(k))).toEqual([])
    expect(env.CLAUDE_CONFIG_DIR).toBe('/data/claude')
  })

  it('uses the configured binary path instead of resolving the bundled one', async () => {
    const r = runner(status({}))
    const resolveBinary = vi.fn(() => '/bundled/claude')
    await testClaudeCodeLogin({
      run: r.run,
      resolveBinary,
      pathToClaudeCodeExecutable: '/custom/claude',
    })
    expect(r.calls[0]?.command).toBe('/custom/claude')
    expect(resolveBinary).not.toHaveBeenCalled()
  })
})

describe('testClaudeCodeLogin with the real process runner', () => {
  it('is unreachable when the binary path does not exist', async () => {
    const res = await testClaudeCodeLogin({
      pathToClaudeCodeExecutable: '/nonexistent/faire-test/claude',
    })
    expect(res).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('reads a non-zero exit as a response, not as unreachable', async () => {
    // node rejects uth status with exit 1 and no JSON on stdout.
    const res = await testClaudeCodeLogin({ pathToClaudeCodeExecutable: process.execPath })
    expect(res).toEqual({ ok: false, reason: 'unexpected_response' })
  })
})

describe('resolveBundledClaudeBinary', () => {
  const resolverFor = (found: string[]) => (spec: string) => {
    if (found.includes(spec)) return `/node_modules/${spec}`
    throw new Error(`Cannot find ${spec}`)
  }

  it('finds the per-platform package next to the SDK', () => {
    expect(
      resolveBundledClaudeBinary({
        platform: 'win32',
        arch: 'x64',
        isMusl: false,
        resolve: resolverFor(['@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe']),
      }),
    ).toBe('/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe')
    expect(
      resolveBundledClaudeBinary({
        platform: 'darwin',
        arch: 'arm64',
        isMusl: false,
        resolve: resolverFor(['@anthropic-ai/claude-agent-sdk-darwin-arm64/claude']),
      }),
    ).toBe('/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
  })

  it('prefers glibc on glibc Linux and musl on musl Linux, falling back to the other', () => {
    const both = resolverFor([
      '@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    ])
    expect(
      resolveBundledClaudeBinary({ platform: 'linux', arch: 'x64', isMusl: false, resolve: both }),
    ).toMatch(/linux-x64\/claude$/)
    expect(
      resolveBundledClaudeBinary({ platform: 'linux', arch: 'x64', isMusl: true, resolve: both }),
    ).toMatch(/linux-x64-musl\/claude$/)
    expect(
      resolveBundledClaudeBinary({
        platform: 'linux',
        arch: 'x64',
        isMusl: true,
        resolve: resolverFor(['@anthropic-ai/claude-agent-sdk-linux-x64/claude']),
      }),
    ).toMatch(/linux-x64\/claude$/)
  })

  it('returns null when no package is installed', () => {
    expect(
      resolveBundledClaudeBinary({
        platform: 'linux',
        arch: 'arm64',
        isMusl: false,
        resolve: resolverFor([]),
      }),
    ).toBeNull()
  })

  it('finds the real binary installed for this machine', () => {
    // Guards the package naming against SDK changes. Skipped where the optional package is absent.
    const found = resolveBundledClaudeBinary()
    if (found === null) return
    expect(found).toMatch(/claude(\.exe)?$/)
  })
})
