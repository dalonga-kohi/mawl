import { describe, expect, it } from 'vitest'
import { Envelope, LenientEnvelope, parseEnvelope } from './events'
import * as f from './fixtures'

const good = {
  v: 1,
  id: '12',
  type: 'notify',
  profileId: f.id('prof'),
  ts: f.TS,
  payload: { title: 't', body: 'b', level: 'info' },
}

describe('Envelope version', () => {
  it('requires v: 1', () => {
    const { v: _v, ...noV } = good
    expect(Envelope.safeParse(noV).success).toBe(false)
    expect(Envelope.safeParse({ ...good, v: 2 }).success).toBe(false)
  })
})

describe('parseEnvelope', () => {
  it('returns the typed event for a known, valid event', () => {
    const r = parseEnvelope(good)
    expect(r).toEqual({ ok: true, event: good })
  })

  it('skips an unknown type without throwing, exposing id and type for the cursor', () => {
    const r = parseEnvelope({ ...good, id: '99', type: 'future.thing', payload: { x: 1 } })
    expect(r).toEqual({ ok: false, reason: 'unknown_type', id: '99', type: 'future.thing' })
  })

  it('skips a newer envelope version, even for a known type', () => {
    const r = parseEnvelope({ ...good, v: 2, id: '100', payload: { shape: 'changed' } })
    expect(r).toEqual({ ok: false, reason: 'unsupported_version', id: '100', type: 'notify' })
  })

  it('reports a known type with a bad payload as invalid, keeping id and type', () => {
    const r = parseEnvelope({ ...good, id: '7', payload: { title: 1 } })
    expect(r).toEqual({ ok: false, reason: 'invalid', id: '7', type: 'notify' })
  })

  it.each([null, undefined, 42, 'str', [], {}, { v: 1 }, { ...good, v: 0 }, { ...good, v: 'x' }])(
    'never throws on garbage %j',
    (raw) => {
      const r = parseEnvelope(raw)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('invalid')
    },
  )

  it('omits id when it is not a valid event id', () => {
    const r = parseEnvelope({ ...good, id: 'abc' })
    expect(r).toEqual({ ok: false, reason: 'invalid', type: 'notify' })
  })
})

describe('LenientEnvelope', () => {
  it('accepts unknown types and arbitrary payloads, but still needs an id', () => {
    const ev = { ...good, v: 3, type: 'future.thing', payload: [1, 2] }
    expect(LenientEnvelope.parse(ev)).toEqual(ev)
    expect(LenientEnvelope.safeParse({ ...ev, id: 'x' }).success).toBe(false)
  })
})
