import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateBlocksModule, parseBlockSource } from './blocks-source.ts'

describe('parseBlockSource edges', () => {
  it('rejects a BOM-prefixed file with a clear block-named error', () => {
    expect(() => parseBlockSource('bom', '﻿version: 1\n\nBody\n')).toThrow(/block "bom"/)
  })

  it.each([
    ['leading zero', 'version: 01\n\nB\n'],
    ['plus sign', 'version: +1\n\nB\n'],
    ['hex', 'version: 0x1\n\nB\n'],
    ['exponent', 'version: 1e3\n\nB\n'],
    ['trailing space', 'version: 1 \n\nB\n'],
    ['no space after colon', 'version:1\n\nB\n'],
    ['two spaces', 'version:  1\n\nB\n'],
    ['uppercase key', 'Version: 1\n\nB\n'],
    ['lone CR endings', 'version: 1\r\rB\r'],
    ['header only, no newline', 'version: 1'],
    ['header and blank only', 'version: 1\n\n'],
    ['fullwidth digit', 'version: １\n\nB\n'],
  ])('rejects %s', (_n, source) => {
    expect(() => parseBlockSource('x', source)).toThrow(/block "x"/)
  })

  it('rejects a body glued to the header, naming the blank line rule, even with a long body', () => {
    expect(() => parseBlockSource('x', 'version: 1\nBody line\nMore\nText\n')).toThrow(
      /followed by a blank line/,
    )
  })

  it('rejects a version too large to represent exactly', () => {
    expect(() => parseBlockSource('x', 'version: 99999999999999999999\n\nB\n')).toThrow(/block "x"/)
  })

  it('accepts a large safe integer version', () => {
    expect(parseBlockSource('x', 'version: 9007199254740991\n\nB\n').version).toBe(9007199254740991)
  })

  it('handles mixed CRLF and LF, extra blank lines and trailing whitespace', () => {
    const b = parseBlockSource('x', 'version: 2\r\n\n\n\r\nA\r\n\nB  \r\n\r\n\n')
    expect(b).toEqual({ version: 2, text: 'A\n\nB' })
  })

  it('keeps a "version:" line inside the body and unicode intact', () => {
    const b = parseBlockSource('x', 'version: 1\n\nžółć 🧑‍💻\nversion: 9\n')
    expect(b.text).toBe('žółć 🧑‍💻\nversion: 9')
    expect(b.version).toBe(1)
  })

  it('handles a very large body', () => {
    const body = 'x'.repeat(3_000_000)
    expect(parseBlockSource('x', `version: 1\n\n${body}\n`).text.length).toBe(body.length)
  })
})

describe('generateBlocksModule edges', () => {
  it('survives bodies with quotes, backticks, ${} , backslashes and U+2028', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mawl-prompts-'))
    const body = 'a "q" `t` ${x} \\n     end'
    writeFileSync(join(dir, 'odd.md'), `version: 1\n\n${body}\n`)
    const out = generateBlocksModule(dir)
    const literal = out.slice(out.indexOf('{', out.indexOf('"odd"')), out.lastIndexOf('},') + 1)
    expect(JSON.parse(literal)).toEqual({ version: 1, text: body })
  })

  it('ignores upper-case .MD, extensionless files and emits an empty object for an empty dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mawl-prompts-'))
    writeFileSync(join(dir, 'X.MD'), 'junk')
    writeFileSync(join(dir, 'README'), 'junk')
    const out = generateBlocksModule(dir)
    expect(out).toContain('export const BLOCKS = {\n} as const')
  })

  it('is deterministic across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mawl-prompts-'))
    writeFileSync(join(dir, 'b.md'), 'version: 1\n\nB\n')
    writeFileSync(join(dir, 'a.md'), 'version: 1\n\nA\n')
    expect(generateBlocksModule(dir)).toBe(generateBlocksModule(dir))
  })

  it('reports the failing block id when one of several files is bad', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mawl-prompts-'))
    writeFileSync(join(dir, 'good.md'), 'version: 1\n\nA\n')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'zbad.md'), 'version: 0\n\nA\n')
    expect(() => generateBlocksModule(dir)).toThrow(/block "zbad"/)
  })
})
