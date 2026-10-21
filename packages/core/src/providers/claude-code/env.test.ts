import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildClaudeEnv } from './env.ts'

afterEach(() => vi.unstubAllEnvs())

describe('buildClaudeEnv', () => {
  it('drops every variable that could pick another account or bill another key, even when set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://evil.example')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-x')
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    vi.stubEnv('CLAUDE_CODE_USE_VERTEX', '1')
    vi.stubEnv('CLAUDE_CODE_USE_FOUNDRY', '1')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws')
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@h/db')
    vi.stubEnv('PATH', '/usr/bin')
    const env = buildClaudeEnv()
    expect(Object.keys(env).some((k) => /^(ANTHROPIC_|CLAUDE_CODE_|AWS_|DATABASE_)/i.test(k))).toBe(
      false,
    )
    expect(env.PATH ?? env.Path).toBeDefined()
  })

  it('passes only the allowlist, case-insensitively, keeping the original name', () => {
    const env = buildClaudeEnv({
      env: {
        Path: 'C:\\bin',
        HOME: '/home/x',
        USERPROFILE: 'C:\\Users\\x',
        https_proxy: 'http://proxy:3128',
        NO_PROXY: 'localhost',
        NODE_EXTRA_CA_CERTS: '/ca.pem',
        LANG: 'en_US.UTF-8',
        SECRET_THING: 'nope',
        MAWL_MASTER_KEY: 'nope',
      },
    })
    expect(env).toEqual({
      Path: 'C:\\bin',
      HOME: '/home/x',
      USERPROFILE: 'C:\\Users\\x',
      https_proxy: 'http://proxy:3128',
      NO_PROXY: 'localhost',
      NODE_EXTRA_CA_CERTS: '/ca.pem',
      LANG: 'en_US.UTF-8',
    })
  })

  it('skips unset and empty values', () => {
    expect(buildClaudeEnv({ env: { PATH: undefined, HOME: '' } })).toEqual({})
  })

  it('sets CLAUDE_CONFIG_DIR from the Mawl option, which wins over an inherited one', () => {
    expect(
      buildClaudeEnv({ env: { CLAUDE_CONFIG_DIR: '/inherited' }, configDir: '/data/claude' }),
    ).toEqual({ CLAUDE_CONFIG_DIR: '/data/claude' })
    expect(buildClaudeEnv({ env: { CLAUDE_CONFIG_DIR: '/inherited' } })).toEqual({
      CLAUDE_CONFIG_DIR: '/inherited',
    })
  })

  it('never lets the config dir option smuggle in a different variable', () => {
    const env = buildClaudeEnv({ env: {}, configDir: '/x' })
    expect(Object.keys(env)).toEqual(['CLAUDE_CONFIG_DIR'])
  })
})
