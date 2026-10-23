import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateBlocksModule, parseBlockSource } from './blocks-source.ts'

describe('parseBlockSource', () => {
  it('reads the version header and returns the body without it', () => {
    const block = parseBlockSource('x', 'version: 3\n\nHello.\nSecond line.\n')
    expect(block).toEqual({ version: 3, text: 'Hello.\nSecond line.' })
  })

  it('normalises CRLF line endings', () => {
    expect(parseBlockSource('x', 'version: 1\r\n\r\nA\r\nB\r\n').text).toBe('A\nB')
  })

  it.each([
    ['no header', 'Hello.\n'],
    ['empty file', ''],
    ['non-numeric version', 'version: abc\n\nBody\n'],
    ['zero version', 'version: 0\n\nBody\n'],
    ['negative version', 'version: -1\n\nBody\n'],
    ['fractional version', 'version: 1.5\n\nBody\n'],
    ['version with trailing junk', 'version: 2 beta\n\nBody\n'],
    ['header not on the first line', '\nversion: 1\n\nBody\n'],
    ['missing blank line after header', 'version: 1\nBody\n'],
    ['empty body', 'version: 1\n\n   \n'],
  ])('rejects a malformed header: %s', (_name, source) => {
    expect(() => parseBlockSource('x', source)).toThrow(/block "x"/)
  })
})

describe('generateBlocksModule', () => {
  it('emits one entry per .md file, sorted by id, ignoring other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mawl-prompts-'))
    writeFileSync(join(dir, 'b-block.md'), 'version: 2\n\nSecond "quoted" text\n')
    writeFileSync(join(dir, 'a-block.md'), 'version: 1\n\nFirst\n')
    writeFileSync(join(dir, 'notes.txt'), 'ignored')
    const out = generateBlocksModule(dir)
    expect(out).toContain('GENERATED')
    expect(out.indexOf('"a-block"')).toBeLessThan(out.indexOf('"b-block"'))
    expect(out).toContain('"version": 2')
    expect(out).toContain('Second \\"quoted\\" text')
    expect(out).not.toContain('ignored')
  })

  it('fails when a file in the directory has a malformed header', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mawl-prompts-'))
    writeFileSync(join(dir, 'bad.md'), 'no header here\n')
    expect(() => generateBlocksModule(dir)).toThrow(/block "bad"/)
  })
})

describe('committed blocks.generated.ts', () => {
  it('matches the prompts directory (run `pnpm --filter @mawl/core generate` after changes)', () => {
    const onDisk = readFileSync(new URL('./blocks.generated.ts', import.meta.url), 'utf8')
    expect(onDisk).toBe(generateBlocksModule(new URL('../../prompts/', import.meta.url)))
  })
})
