import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConfigError, parseConfig } from './config.ts'

const URL_WITH_PASSWORD = 'postgres://faire:s3cr3t-pw@db:5432/faire'

describe('parseConfig', () => {
  it('applies defaults', () => {
    expect(parseConfig({ DATABASE_URL: URL_WITH_PASSWORD })).toEqual({
      databaseUrl: URL_WITH_PASSWORD,
      host: '127.0.0.1',
      port: 7420,
      secretsDir: '.faire/secrets',
      siwcPort: 1455,
      siwcHost: '127.0.0.1',
      claudeConfigDir: undefined,
      claudeCodePath: undefined,
      logLevel: 'info',
    })
  })

  it('reads every variable', () => {
    expect(
      parseConfig({
        DATABASE_URL: 'postgresql://u:p@h/d',
        FAIRE_HOST: '0.0.0.0',
        FAIRE_PORT: '8080',
        FAIRE_SECRETS_DIR: '/secrets',
        FAIRE_SIWC_PORT: '1456',
        FAIRE_SIWC_BIND_HOST: '0.0.0.0',
        FAIRE_CLAUDE_CONFIG_DIR: '/data/claude',
        FAIRE_CLAUDE_CODE_PATH: '/opt/claude',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      databaseUrl: 'postgresql://u:p@h/d',
      host: '0.0.0.0',
      port: 8080,
      secretsDir: '/secrets',
      siwcPort: 1456,
      siwcHost: '0.0.0.0',
      claudeConfigDir: '/data/claude',
      claudeCodePath: '/opt/claude',
      logLevel: 'debug',
    })
  })

  it('treats empty strings as unset for optional variables', () => {
    const cfg = parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, FAIRE_PORT: '', LOG_LEVEL: '' })
    expect(cfg.port).toBe(7420)
    expect(cfg.logLevel).toBe('info')
  })

  it('treats empty Claude variables as unset', () => {
    const cfg = parseConfig({
      DATABASE_URL: URL_WITH_PASSWORD,
      FAIRE_CLAUDE_CONFIG_DIR: '',
      FAIRE_CLAUDE_CODE_PATH: '',
    })
    expect(cfg.claudeConfigDir).toBeUndefined()
    expect(cfg.claudeCodePath).toBeUndefined()
  })

  it.each(['FAIRE_CLAUDE_CONFIG_DIR', 'FAIRE_CLAUDE_CODE_PATH'])(
    'rejects a relative %s, names it and does not echo the value',
    (name) => {
      const run = () => parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, [name]: 'rel/secret-dir' })
      expect(run).toThrow(ConfigError)
      expect(run).toThrow(new RegExp(`${name}: must be an absolute path`))
      expect(run).not.toThrow(/secret-dir/)
    },
  )

  it('accepts absolute Claude paths and leaves them unset when absent', () => {
    const abs = resolve('claude-abs')
    const cfg = parseConfig({
      DATABASE_URL: URL_WITH_PASSWORD,
      FAIRE_CLAUDE_CONFIG_DIR: abs,
      FAIRE_CLAUDE_CODE_PATH: abs,
    })
    expect(cfg.claudeConfigDir).toBe(abs)
    expect(cfg.claudeCodePath).toBe(abs)
    const none = parseConfig({ DATABASE_URL: URL_WITH_PASSWORD })
    expect(none.claudeConfigDir).toBeUndefined()
    expect(none.claudeCodePath).toBeUndefined()
  })

  it('names the missing DATABASE_URL', () => {
    expect(() => parseConfig({})).toThrow(ConfigError)
    expect(() => parseConfig({})).toThrow(/DATABASE_URL/)
  })

  it.each([
    ['FAIRE_PORT', '99999'],
    ['FAIRE_PORT', 'abc'],
    ['FAIRE_PORT', '0'],
    ['FAIRE_SIWC_PORT', '0'],
    ['FAIRE_SIWC_PORT', '70000'],
    ['FAIRE_SIWC_PORT', 'abc'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s and names the variable', (name, value) => {
    expect(() => parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, [name]: value })).toThrow(
      new RegExp(name),
    )
  })

  it('never puts values in the error, including the database password', () => {
    for (const env of [
      { DATABASE_URL: 'mysql://faire:s3cr3t-pw@db/faire' },
      { DATABASE_URL: 'postgres://faire:s3cr3t-pw@[bad/faire' },
      { DATABASE_URL: URL_WITH_PASSWORD, FAIRE_PORT: 'hunter2-port' },
      { DATABASE_URL: URL_WITH_PASSWORD, LOG_LEVEL: 'hunter2-level' },
    ]) {
      let message = ''
      try {
        parseConfig(env)
      } catch (e) {
        message = (e as Error).message
      }
      expect(message).not.toBe('')
      expect(message).not.toContain('s3cr3t-pw')
      expect(message).not.toContain('hunter2')
    }
  })

  it('lists every bad variable at once', () => {
    expect(() => parseConfig({ FAIRE_PORT: 'x', LOG_LEVEL: 'y' })).toThrow(
      /DATABASE_URL[\s\S]*FAIRE_PORT[\s\S]*LOG_LEVEL|FAIRE_PORT[\s\S]*LOG_LEVEL[\s\S]*DATABASE_URL/,
    )
  })
})

describe('parseConfig with the real process.env', () => {
  it('never throws text containing the DATABASE_URL password from the environment', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://faire:env-s3cr3t@db:5432/faire')
    vi.stubEnv('FAIRE_PORT', 'not-a-port')
    try {
      let text = ''
      try {
        parseConfig()
      } catch (e) {
        text = `${(e as Error).message}${(e as Error).stack}${JSON.stringify((e as ConfigError).issues)}`
      }
      expect(text).toContain('FAIRE_PORT')
      expect(text).not.toContain('env-s3cr3t')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
