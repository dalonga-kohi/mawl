import { describe, expect, it } from 'vitest'
import { arcPath, beadAngle, beadStates, onRing, RING } from './ring.ts'

describe('the progress ring', () => {
  it('closes the ring at the top with the last bead', () => {
    expect(beadAngle(2)).toBe(270)
    expect(onRing(beadAngle(2))).toEqual({ x: RING.box / 2, y: RING.box / 2 - RING.r })
    expect(beadAngle(0)).toBe(30)
    expect(beadAngle(1)).toBe(150)
  })

  it('draws each arc clockwise and clear of the beads at both ends', () => {
    for (const i of [0, 1, 2]) {
      const [, x1, y1, , , , , , , x2, y2] = arcPath(i).split(' ')
      const from = onRing(beadAngle(i) - 120 + RING.gapDeg)
      const to = onRing(beadAngle(i) - RING.gapDeg)
      expect([Number(x1), Number(y1)]).toEqual([from.x, from.y])
      expect([Number(x2), Number(y2)]).toEqual([to.x, to.y])
      expect(arcPath(i)).toContain(`A ${RING.r} ${RING.r} 0 0 1`)
    }
    // The gap is wider than a bead, so an arc never runs under one.
    const beadDeg = (Math.asin(RING.bead / RING.r) * 180) / Math.PI
    expect(RING.gapDeg).toBeGreaterThan(beadDeg)
  })

  it('lights the beads from the real progress', () => {
    expect(beadStates(0, true)).toEqual(['active', 'todo', 'todo'])
    expect(beadStates(1, true)).toEqual(['done', 'active', 'todo'])
    expect(beadStates(3, false)).toEqual(['done', 'done', 'done'])
    expect(beadStates(0, false)).toEqual(['todo', 'todo', 'todo'])
  })
})
