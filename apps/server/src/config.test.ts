import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConfigError, parseConfig } from './config.ts'

const URL_WITH_PASSWORD = 'postgres://mawl:s3cr3t-pw@db:5432/mawl'

describe('parseConfig', () => {
  it('applies defaults', () => {
    expect(parseConfig({ DATABASE_URL: URL_WITH_PASSWORD })).toEqual({
      databaseUrl: URL_WITH_PASSWORD,
      host: '127.0.0.1',
      port: 7420,
      secretsDir: '.mawl/secrets',
      siwcPort: 1455,
      siwcHost: '127.0.0.1',
      claudeConfigDir: undefined,
      claudeCodePath: undefined,
      allowedOrigins: [],
      logLevel: 'info',
    })
  })

  it('reads every variable', () => {
    expect(
      parseConfig({
        DATABASE_URL: 'postgresql://u:p@h/d',
        MAWL_HOST: '0.0.0.0',
        MAWL_PORT: '8080',
        MAWL_SECRETS_DIR: '/secrets',
        MAWL_SIWC_PORT: '1456',
        MAWL_SIWC_BIND_HOST: '0.0.0.0',
        MAWL_CLAUDE_CONFIG_DIR: '/data/claude',
        MAWL_CLAUDE_CODE_PATH: '/opt/claude',
        MAWL_ALLOWED_ORIGINS: 'https://mawl.example.com, http://192.168.1.5:5173',
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
      allowedOrigins: ['https://mawl.example.com', 'http://192.168.1.5:5173'],
      logLevel: 'debug',
    })
  })

  it('treats empty strings as unset for optional variables', () => {
    const cfg = parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, MAWL_PORT: '', LOG_LEVEL: '' })
    expect(cfg.port).toBe(7420)
    expect(cfg.logLevel).toBe('info')
  })

  it('treats empty Claude variables as unset', () => {
    const cfg = parseConfig({
      DATABASE_URL: URL_WITH_PASSWORD,
      MAWL_CLAUDE_CONFIG_DIR: '',
      MAWL_CLAUDE_CODE_PATH: '',
    })
    expect(cfg.claudeConfigDir).toBeUndefined()
    expect(cfg.claudeCodePath).toBeUndefined()
  })

  it.each(['MAWL_CLAUDE_CONFIG_DIR', 'MAWL_CLAUDE_CODE_PATH'])(
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
      MAWL_CLAUDE_CONFIG_DIR: abs,
      MAWL_CLAUDE_CODE_PATH: abs,
    })
    expect(cfg.claudeConfigDir).toBe(abs)
    expect(cfg.claudeCodePath).toBe(abs)
    const none = parseConfig({ DATABASE_URL: URL_WITH_PASSWORD })
    expect(none.claudeConfigDir).toBeUndefined()
    expect(none.claudeCodePath).toBeUndefined()
  })

  it('reads MAWL_WEB_DIR as an absolute path, unset when empty or absent', () => {
    const abs = resolve('web-build')
    const base = { DATABASE_URL: URL_WITH_PASSWORD }
    expect(parseConfig({ ...base, MAWL_WEB_DIR: abs }).webDir).toBe(abs)
    expect(parseConfig({ ...base, MAWL_WEB_DIR: '' }).webDir).toBeUndefined()
    expect(parseConfig(base).webDir).toBeUndefined()
    const run = () => parseConfig({ ...base, MAWL_WEB_DIR: 'rel/web' })
    expect(run).toThrow(/MAWL_WEB_DIR: must be an absolute path/)
    expect(run).not.toThrow(/rel\/web/)
  })

  it('parses MAWL_ALLOWED_ORIGINS as a trimmed list and treats empty as none', () => {
    const base = { DATABASE_URL: URL_WITH_PASSWORD }
    expect(parseConfig({ ...base, MAWL_ALLOWED_ORIGINS: '' }).allowedOrigins).toEqual([])
    expect(
      parseConfig({ ...base, MAWL_ALLOWED_ORIGINS: ' https://a.example/ ,,tauri://localhost' })
        .allowedOrigins,
    ).toEqual(['https://a.example', 'tauri://localhost'])
  })

  it('rejects an allowed origin that is not a bare origin, naming the variable but not the value', () => {
    for (const bad of [
      '*',
      'mawl.example.com',
      'https://a.example/path',
      'https://a.example?x=1',
    ]) {
      let message = ''
      try {
        parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, MAWL_ALLOWED_ORIGINS: bad })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toContain('MAWL_ALLOWED_ORIGINS')
      expect(message).not.toContain(bad)
    }
  })

  it('names the missing DATABASE_URL', () => {
    expect(() => parseConfig({})).toThrow(ConfigError)
    expect(() => parseConfig({})).toThrow(/DATABASE_URL/)
  })

  it.each([
    ['MAWL_PORT', '99999'],
    ['MAWL_PORT', 'abc'],
    ['MAWL_PORT', '0'],
    ['MAWL_SIWC_PORT', '0'],
    ['MAWL_SIWC_PORT', '70000'],
    ['MAWL_SIWC_PORT', 'abc'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s and names the variable', (name, value) => {
    expect(() => parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, [name]: value })).toThrow(
      new RegExp(name),
    )
  })

  it('never puts values in the error, including the database password', () => {
    for (const env of [
      { DATABASE_URL: 'mysql://mawl:s3cr3t-pw@db/mawl' },
      { DATABASE_URL: 'postgres://mawl:s3cr3t-pw@[bad/mawl' },
      { DATABASE_URL: URL_WITH_PASSWORD, MAWL_PORT: 'hunter2-port' },
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
    expect(() => parseConfig({ MAWL_PORT: 'x', LOG_LEVEL: 'y' })).toThrow(
      /DATABASE_URL[\s\S]*MAWL_PORT[\s\S]*LOG_LEVEL|MAWL_PORT[\s\S]*LOG_LEVEL[\s\S]*DATABASE_URL/,
    )
  })
})

describe('parseConfig with the real process.env', () => {
  it('never throws text containing the DATABASE_URL password from the environment', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://mawl:env-s3cr3t@db:5432/mawl')
    vi.stubEnv('MAWL_PORT', 'not-a-port')
    try {
      let text = ''
      try {
        parseConfig()
      } catch (e) {
        text = `${(e as Error).message}${(e as Error).stack}${JSON.stringify((e as ConfigError).issues)}`
      }
      expect(text).toContain('MAWL_PORT')
      expect(text).not.toContain('env-s3cr3t')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
