import { describe, expect, it } from 'vitest'
import { createLogger } from './logger.ts'

function capture(level: 'info' | 'debug' | 'silent' = 'info') {
  const lines: string[] = []
  const logger = createLogger({
    level,
    stream: { write: (chunk: string) => void lines.push(chunk) },
  })
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) }
}

describe('createLogger', () => {
  it('writes structured JSON lines with the message', () => {
    const { logger, parsed } = capture()
    logger.info({ profileId: 'p1', runId: 'r1', step: 3 }, 'hello')
    expect(parsed()[0]).toMatchObject({ msg: 'hello', profileId: 'p1', runId: 'r1', step: 3 })
  })

  it('honours the level', () => {
    const { logger, lines } = capture('info')
    logger.debug('quiet')
    expect(lines).toHaveLength(0)
    const silent = capture('silent')
    silent.logger.error('nope')
    expect(silent.lines).toHaveLength(0)
  })

  it.each([['secret'], ['apiKey'], ['token'], ['password'], ['secretEnc'], ['databaseUrl']])(
    'redacts %s at top level and one level down',
    (field) => {
      const { logger, lines } = capture()
      logger.info({ [field]: 'LEAK-ME', nested: { [field]: 'LEAK-ME' } }, 'x')
      expect(lines[0]).not.toContain('LEAK-ME')
      expect(lines[0]).toContain('[Redacted]')
    },
  )

  it('redacts authorization and cookie request headers', () => {
    const { logger, lines } = capture()
    logger.info(
      {
        req: { headers: { authorization: 'Bearer LEAK-ME', cookie: 'sid=LEAK-ME', accept: 'ok' } },
      },
      'req',
    )
    expect(lines[0]).not.toContain('LEAK-ME')
    expect(lines[0]).toContain('"accept":"ok"')
  })

  it('scrubs a url password from a raw Error message and stack', () => {
    const { logger, lines } = capture()
    logger.error({ err: new Error('connect postgres://u:pw-LEAK@h/db refused') }, 'failed')
    expect(lines.join('')).not.toContain('pw-LEAK')
    expect(lines.join('')).toContain('refused')
  })

  it('serialises errors with their message', () => {
    const { logger, parsed } = capture()
    logger.error({ err: new Error('boom') }, 'failed')
    expect(parsed()[0]).toMatchObject({ err: { message: 'boom' } })
  })
})
