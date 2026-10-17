import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readVersion } from './version.ts'

describe('readVersion', () => {
  it("returns the version in the server's package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(readVersion()).toBe(pkg.version)
  })
})
