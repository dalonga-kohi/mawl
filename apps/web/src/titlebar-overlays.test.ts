import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sources(path)
    return /\.tsx$/.test(e.name) && !/\.test\./.test(e.name) ? [path] : []
  })
}

describe('overlays and the title bar', () => {
  it('starts every full-height overlay below the bar, so its drag region and buttons stay usable', () => {
    // `inset-0` and `inset-y-0` reach the top edge; `top-(--titlebar-h)` (0 in a browser) clears it.
    const offenders = sources(import.meta.dirname)
      .filter((file) => /fixed[^"'`]*\binset-(0|y-0)\b/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(import.meta.dirname.length + 1))
    expect(offenders).toEqual([])
  })
})
