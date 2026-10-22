import { describe, expect, it } from 'vitest'
import { embeddedPgPolicy } from './test-policy.ts'

const has = () => true
const hasNot = () => false

describe('embeddedPgPolicy', () => {
  it('runs on Windows with MAWL_PG_ROOT pointing at the binaries', () => {
    expect(
      embeddedPgPolicy({ platform: 'win32', env: { MAWL_PG_ROOT: 'C:\\pg' }, hasBinaries: has }),
    ).toMatchObject({ action: 'run', pgRoot: 'C:\\pg' })
  })

  it.each([
    ['not Windows', 'linux', { MAWL_PG_ROOT: '/pg' }, has],
    ['MAWL_PG_ROOT unset', 'win32', {}, has],
    ['MAWL_PG_ROOT empty', 'win32', { MAWL_PG_ROOT: '' }, has],
    ['binaries missing', 'win32', { MAWL_PG_ROOT: 'C:\\pg' }, hasNot],
  ] as const)('skips when %s', (_label, platform, env, hasBinaries) => {
    expect(embeddedPgPolicy({ platform, env, hasBinaries })).toMatchObject({ action: 'skip' })
  })

  it.each([
    ['not Windows', 'linux', { MAWL_PG_ROOT: '/pg' }, has],
    ['MAWL_PG_ROOT unset', 'win32', {}, has],
    ['binaries missing', 'win32', { MAWL_PG_ROOT: 'C:\\pg' }, hasNot],
  ] as const)(
    'fails when MAWL_REQUIRE_EMBEDDED_PG is set and %s',
    (_l, platform, env, hasBinaries) => {
      const r = embeddedPgPolicy({
        platform,
        env: { ...env, MAWL_REQUIRE_EMBEDDED_PG: '1' },
        hasBinaries,
      })
      expect(r.action).toBe('fail')
      expect(r.reason).not.toBe('')
    },
  )

  it('treats MAWL_REQUIRE_EMBEDDED_PG=0 or false as unset', () => {
    for (const v of ['0', 'false', '']) {
      expect(
        embeddedPgPolicy({
          platform: 'linux',
          env: { MAWL_REQUIRE_EMBEDDED_PG: v },
          hasBinaries: has,
        }).action,
      ).toBe('skip')
    }
  })

  it('does not require the suite just because CI is set (Linux CI cannot run it)', () => {
    expect(
      embeddedPgPolicy({ platform: 'linux', env: { CI: 'true' }, hasBinaries: has }).action,
    ).toBe('skip')
  })
})
