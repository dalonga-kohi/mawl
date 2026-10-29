import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const output = mkdtempSync(join(tmpdir(), 'mawl-orb-test-'))
const generator = join(import.meta.dirname, '../design/assets/mascot-orb/build.mjs')
const names = ['mawl-flat.svg', 'mawl-soft.svg', 'mawl-grain.svg', 'sheet.html']

beforeAll(() => execFileSync(process.execPath, [generator, output]))
afterAll(() => rmSync(output, { recursive: true, force: true }))

describe('generated mascot assets', () => {
  it('gives every standalone and inline mascot SVG an accessible name', () => {
    for (const name of names) {
      const source = readFileSync(join(output, name), 'utf8')
      const svgs = [...source.matchAll(/<svg\b[^>]*>/g)]
      expect(svgs.length).toBeGreaterThan(0)
      for (const [svg] of svgs) {
        expect(svg, name).toContain('role="img"')
        expect(svg, name).toMatch(/aria-label="[^"]+"/)
      }
    }
  })

  it('emits unique attributes and preserves the thinner ring and star strokes', () => {
    const source = readFileSync(join(output, 'sheet.html'), 'utf8')
    for (const [tag] of source.matchAll(/<[a-z][^>]*>/gi)) {
      const attributes = [...tag.matchAll(/([\w-]+)="[^"]*"/g)].map((match) => match[1])
      expect(new Set(attributes).size, tag).toBe(attributes.length)
    }
    expect(source).toMatch(/<circle r="16"[^>]*stroke-width="11"/)
    expect(source).toMatch(/<path d="M0 -22V22"[^>]*stroke-width="12"/)
  })
})
