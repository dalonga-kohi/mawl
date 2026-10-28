import { describe, expect, it } from 'vitest'
import { commandPrefixMatch, globMatch, MAX_SUBJECT_CHARS } from './match.ts'

describe('globMatch', () => {
  it.each([
    ['notes/*', 'notes/a.md', true],
    ['notes/*', 'notes/', true],
    ['notes/*', 'other/notes/a.md', false],
    ['*.md', 'a/b.md', true],
    ['*.md', 'a/b.mdx', false],
    ['a*b*c', 'axxbyyc', true],
    ['a*b*c', 'axxbyy', false],
    ['exact', 'exact', true],
    ['exact', 'exactly', false],
    ['exact', 'Exact', false],
    ['a.c', 'abc', false],
    ['(a+)+$', '(a+)+$', true],
    ['*', '', true],
  ])('%s against %s is %s', (pattern, subject, expected) => {
    expect(globMatch(pattern, subject)).toBe(expected)
  })

  it('never matches a subject over the cap', () => {
    expect(globMatch('*', 'x'.repeat(MAX_SUBJECT_CHARS + 1))).toBe(false)
  })

  it('stays fast on a hostile pattern and subject (no backtracking blow-up)', () => {
    const pattern = `${'*a'.repeat(50)}b`
    const subject = 'a'.repeat(MAX_SUBJECT_CHARS)
    const start = performance.now()
    expect(globMatch(pattern, subject)).toBe(false)
    // Linear-ish worst case is pattern x subject (about 400k steps); exponential would never end.
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('commandPrefixMatch', () => {
  it.each([
    ['git status', 'git status', true],
    ['git status', 'git status --short', true],
    ['git status', 'git status\t-s', true],
    ['git status', 'git statusx', false],
    ['git status', 'git stat', false],
    ['git status', ' git status', false],
    ['git status', 'git  status', false],
    ['git status', 'git status; rm -rf x', false],
    ['git status', 'git status && rm x', false],
    ['git status', 'git status | tee x', false],
    ['git status', 'git status & calc', false],
    ['git status', 'git status\nrm x', false],
    ['git status', 'git status\r\nrm x', false],
    ['git status', 'git status `rm x`', false],
    ['git status', 'git status $(rm x)', false],
    ['git status', 'git status > out.txt', false],
    ['git status', 'git status < in.txt', false],
    ['git status', 'git status "$env:X"', false],
    ['git status', 'git status (rm x)', false],
    ['git status', 'git status {rm x}', false],
    ['git status', 'git status ^& calc', false],
    ['git status', 'git status %COMSPEC%', false],
    ['git status', 'git status !x!', false],
    ['git status', 'git status -- "a b.txt"', true],
    ['git status', "git status -- 'a b.txt'", true],
    ['git status', 'git status C:\\work\\repo', true],
    ['git *', 'git push', false],
    ['git status;', 'git status; rm x', false],
    ['', 'anything', false],
  ])('prefix %j against %j is %s', (prefix, command, expected) => {
    expect(commandPrefixMatch(prefix, command)).toBe(expected)
  })

  it('never matches a command over the cap', () => {
    expect(commandPrefixMatch('ls', `ls ${'a'.repeat(MAX_SUBJECT_CHARS)}`)).toBe(false)
  })
})
