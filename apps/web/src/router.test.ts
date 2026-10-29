import { describe, expect, it } from 'vitest'
import { createAppRouter } from './router.tsx'

describe('router', () => {
  it('loads a route on hover or focus intent so a teammate opens without a chunk wait', () => {
    expect(createAppRouter({ initialPath: '/' }).options.defaultPreload).toBe('intent')
  })
})
