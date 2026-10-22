import { describe, expect, it } from 'vitest'
import { ConfigError } from './config.ts'
import { EmbeddedPgError } from './embedded-pg/index.ts'
import { describeFailure } from './failure.ts'
import { LaunchTokenError } from './launch-token.ts'
import { HostKeyError, MasterKeyError, SecretDecryptError } from './secrets/index.ts'

describe('describeFailure', () => {
  it('logs only the name and code for foreign errors, never the message', () => {
    const err = Object.assign(new Error('connect failed for postgres://u:LEAK-ME@h/d'), {
      code: 'ECONNREFUSED',
      connectionString: 'postgres://u:LEAK-ME@h/d',
    })
    const out = describeFailure(err)
    expect(out).toEqual({ errName: 'Error', code: 'ECONNREFUSED' })
    expect(JSON.stringify(out)).not.toContain('LEAK-ME')
  })

  it('drops codes that are not short upper-case identifiers', () => {
    const err = Object.assign(new Error('x'), { code: 'postgres://u:LEAK-ME@h/d' })
    expect(describeFailure(err)).toEqual({ errName: 'Error' })
  })

  it('includes the reason for our own error classes', () => {
    expect(
      describeFailure(new ConfigError([{ name: 'MAWL_PORT', message: 'must be 1-65535' }])),
    ).toMatchObject({
      errName: 'ConfigError',
      reason: expect.stringContaining('MAWL_PORT'),
    })
    expect(describeFailure(new MasterKeyError('bad key file'))).toMatchObject({
      errName: 'MasterKeyError',
      reason: 'bad key file',
    })
    expect(describeFailure(new SecretDecryptError())).toMatchObject({
      reason: 'Failed to decrypt secret',
    })
  })

  it('keeps the typed code of an embedded Postgres boot error but not its wrapped message', () => {
    const err = new EmbeddedPgError('start_failed', 'Postgres startup check failed: LEAK-ME')
    expect(describeFailure(err)).toEqual({ errName: 'EmbeddedPgError', code: 'start_failed' })
  })

  it('keeps the code and fixed reason of a launch token error', () => {
    expect(describeFailure(new LaunchTokenError('invalid'))).toMatchObject({
      errName: 'LaunchTokenError',
      code: 'invalid',
      reason: expect.stringContaining('launch token invalid'),
    })
  })

  it('keeps the code and fixed reason of a host master key error', () => {
    expect(describeFailure(new HostKeyError('timeout'))).toMatchObject({
      errName: 'HostKeyError',
      code: 'timeout',
      reason: expect.stringContaining('master key missing'),
    })
  })

  it('handles non-Error throwables', () => {
    expect(describeFailure('postgres://u:LEAK-ME@h/d')).toEqual({ errName: 'UnknownError' })
    expect(describeFailure(undefined)).toEqual({ errName: 'UnknownError' })
  })
})
