import { HexColor } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { ACCENT_PRESETS } from './errors.ts'

describe('default teammate colors', () => {
  it('start with Mawl lime and rotate through the soft presets of DESIGN.md §3', () => {
    // The same order and values as accentPresets in @mawl/ui (palette.ts).
    expect([...ACCENT_PRESETS]).toEqual([
      '#D8E88A',
      '#A9D3F5',
      '#F7C4A3',
      '#CBB9F4',
      '#F4B6C4',
      '#B9C3CF',
    ])
  })

  it('are all valid teammate colors', () => {
    for (const hex of ACCENT_PRESETS) expect(HexColor.safeParse(hex).success, hex).toBe(true)
  })
})
