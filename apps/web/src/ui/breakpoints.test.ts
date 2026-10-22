import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

describe('responsive classes', () => {
  it('only use the breakpoints styles.css defines (md 760, lg 1100), so none is silently dead', () => {
    const css = readFileSync(join(root, 'styles.css'), 'utf8')
    expect(css).toMatch(/--breakpoint-\*:\s*initial/)
    const dead: string[] = []
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(?<![\w-])(sm|xl|2xl):[\w[]/g)) dead.push(`${file}: ${m[0]}`)
    }
    expect(dead).toEqual([])
  })
})
