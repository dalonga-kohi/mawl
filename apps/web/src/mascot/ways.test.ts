import { describe, expect, it } from 'vitest'
import { ORB_WAYS, orbColors, WAYS, wayForColor } from './ways.ts'

describe('orb colourways', () => {
  it('lists the eight colourways with orange first', () => {
    expect(ORB_WAYS).toEqual([
      'orange',
      'lavender',
      'purple',
      'night',
      'teal',
      'peach',
      'rose',
      'sky',
    ])
    expect(WAYS.orange).toEqual({ body: '#FF9A4D', ink: '#35170A' })
    expect(WAYS.lavender).toEqual({ body: '#BDA4ED', ink: '#1B1233' })
    expect(WAYS.purple).toEqual({ body: '#7950E8', ink: '#F2F5FC' })
  })

  it('derives the soft light and shade the same way the art build does', () => {
    // build.mjs: lighten(body, 0.22) and darken(body, 0.14), mixed in sRGB.
    expect(orbColors('lavender')).toEqual({
      body: '#BDA4ED',
      ink: '#1B1233',
      hi: '#ccb8f1',
      lo: '#a38dcc',
    })
  })
})

describe('wayForColor', () => {
  it('maps the old soft teammate presets onto a colourway', () => {
    expect(wayForColor('#D8E88A')).toBe('orange')
    expect(wayForColor('#A9D3F5')).toBe('sky')
    expect(wayForColor('#F7C4A3')).toBe('peach')
    expect(wayForColor('#CBB9F4')).toBe('purple')
    expect(wayForColor('#F4B6C4')).toBe('rose')
    expect(wayForColor('#B9C3CF')).toBe('night')
  })

  it('maps a colourway body to its own colourway, in any case', () => {
    for (const way of ORB_WAYS) {
      expect(wayForColor(WAYS[way].body), way).toBe(way)
      expect(wayForColor(WAYS[way].body.toLowerCase()), way).toBe(way)
    }
  })

  it('picks the nearest colourway for any other color', () => {
    expect(wayForColor('#00C2A8')).toBe('teal')
    expect(wayForColor('#FF8FB0')).toBe('rose')
  })

  it('falls back to orange for missing or invalid input', () => {
    expect(wayForColor(undefined)).toBe('orange')
    expect(wayForColor('red')).toBe('orange')
    expect(wayForColor('#12345')).toBe('orange')
  })
})
