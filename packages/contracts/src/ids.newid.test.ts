import { describe, expect, it } from 'vitest'
import { ID_KINDS, ID_PREFIX, idSchema, isId, newId } from './ids'

const seq = (values: number[]) => {
  let i = 0
  return () => values[i++ % values.length] as number
}

describe('newId', () => {
  it.each(ID_KINDS)('%s: produces an id that matches idSchema', (kind) => {
    const id = newId(kind, { now: () => 1_700_000_000_000 + ID_KINDS.indexOf(kind) * 10_000 })
    expect(id.startsWith(`${ID_PREFIX[kind]}_`)).toBe(true)
    expect(idSchema(kind).safeParse(id).success).toBe(true)
  })

  it('is deterministic for an injected clock and entropy', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    const id = newId('run', { now: () => 1_800_000_000_000, random: seq([0, 0.5, 0.999]) })
    const decoded = [...id.slice(4, 14)].reduce((n, c) => n * 32 + alphabet.indexOf(c), 0)
    expect(decoded).toBe(1_800_000_000_000)
    expect(id.slice(14)).toBe('0GZ0GZ0GZ0GZ0GZ0')
  })
  it('encodes the timestamp so ids sort by time', () => {
    const early = newId('run', { now: () => 1_900_000_000_000 })
    const late = newId('run', { now: () => 1_900_000_000_001 })
    expect(early < late).toBe(true)
  })

  it('is strictly monotonic for 1000 ids minted in the same millisecond', () => {
    const now = () => 2_000_000_000_000
    const ids = Array.from({ length: 1000 }, () => newId('run', { now, random: () => 0.999999 }))
    expect(new Set(ids).size).toBe(1000)
    expect([...ids].sort()).toEqual(ids)
    for (const id of ids) expect(isId('run', id)).toBe(true)
  })

  it('stays monotonic when the clock goes backwards', () => {
    const a = newId('run', { now: () => 2_100_000_000_005 })
    const b = newId('run', { now: () => 2_100_000_000_000 })
    expect(b > a).toBe(true)
  })
})

describe('idSchema ULID timestamp', () => {
  it('rejects a first timestamp char above 7 (overflow of 48 bits)', () => {
    expect(isId('run', 'run_8ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(false)
    expect(isId('run', 'run_7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true)
  })
})
