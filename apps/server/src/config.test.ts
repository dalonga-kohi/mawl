import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig } from './config.ts'

const URL_WITH_PASSWORD = 'postgres://faire:s3cr3t-pw@db:5432/faire'

describe('parseConfig', () => {
  it('applies defaults', () => {
    expect(parseConfig({ DATABASE_URL: URL_WITH_PASSWORD })).toEqual({
      databaseUrl: URL_WITH_PASSWORD,
      host: '127.0.0.1',
      port: 7420,
      secretsDir: '.faire/secrets',
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
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      databaseUrl: 'postgresql://u:p@h/d',
      host: '0.0.0.0',
      port: 8080,
      secretsDir: '/secrets',
      logLevel: 'debug',
    })
  })

  it('treats empty strings as unset for optional variables', () => {
    const cfg = parseConfig({ DATABASE_URL: URL_WITH_PASSWORD, FAIRE_PORT: '', LOG_LEVEL: '' })
    expect(cfg.port).toBe(7420)
    expect(cfg.logLevel).toBe('info')
  })

  it('names the missing DATABASE_URL', () => {
    expect(() => parseConfig({})).toThrow(ConfigError)
    expect(() => parseConfig({})).toThrow(/DATABASE_URL/)
  })

  it.each([
    ['FAIRE_PORT', '99999'],
    ['FAIRE_PORT', 'abc'],
    ['FAIRE_PORT', '0'],
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
