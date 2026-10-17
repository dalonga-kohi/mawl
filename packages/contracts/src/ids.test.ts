import { describe, expect, it } from 'vitest'
import { ID_KINDS, ID_PREFIX, idSchema, isId, ProfileId, RunId } from './ids'

const ULID = '01HZX3K9V2M4N6P8Q0R2S4T6V8'

describe('ids', () => {
  it('accepts a prefixed ULID for every kind', () => {
    for (const kind of ID_KINDS) {
      expect(isId(kind, `${ID_PREFIX[kind]}_${ULID}`)).toBe(true)
      expect(idSchema(kind).safeParse(`${ID_PREFIX[kind]}_${ULID}`).success).toBe(true)
    }
  })

  it('rejects an id carrying another entity prefix', () => {
    expect(isId('run', `prof_${ULID}`)).toBe(false)
    expect(RunId.safeParse(`prof_${ULID}`).success).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['no prefix', ULID],
    ['too short', 'run_01HZX3K9'],
    ['forbidden letter U', 'run_01HZX3K9V2M4N6P8Q0R2S4T6VU'],
    ['lowercase', `run_${ULID.toLowerCase()}`],
    ['trailing junk', `run_${ULID}x`],
  ])('rejects a malformed id (%s)', (_name, value) => {
    expect(isId('run', value)).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isId('run', 42)).toBe(false)
    expect(ProfileId.safeParse(null).success).toBe(false)
  })

  it('brands parsed ids so kinds are not interchangeable at the type level', () => {
    const p = ProfileId.parse(`prof_${ULID}`)
    // @ts-expect-error a ProfileId is not assignable to RunId
    const r: import('./ids').RunId = p
    expect(r).toBe(p)
  })
})
