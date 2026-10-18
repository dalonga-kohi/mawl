import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Anthropic's terms allow a Claude subscription only through Claude Code's own sign-in flow
 * (code.claude.com/docs/en/legal-and-compliance). Faire therefore never reads, copies or parses
 * Claude credentials and never takes a Claude token. This guard keeps code from drifting there:
 * the strings below may appear in docs and in the negative tests that prove they are dropped.
 */
const root = join(import.meta.dirname, '..')

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|ya?ml|sql|sh|ps1|toml|env|example)$/.test(f))

const SELF = 'scripts/claude-terms.test.ts'
const DOCS = ['docs/', '.claude/', 'CLAUDE.md']
const CLAUDE_CODE_DIR = 'packages/core/src/providers/claude-code/'

const rules: Array<{ term: string; allowedIn: string[] }> = [
  // The credential file and the keychain entry belong to the binary alone.
  { term: '.credentials.json', allowedIn: [SELF, ...DOCS] },
  { term: 'Claude Code-credentials', allowedIn: [SELF, ...DOCS] },
  { term: 'setup-token', allowedIn: [SELF, ...DOCS] },
  // Dropped from the subprocess env; named only where tests prove it.
  { term: 'CLAUDE_CODE_OAUTH_TOKEN', allowedIn: [SELF, ...DOCS, CLAUDE_CODE_DIR] },
]

describe('Claude account terms guard', () => {
  it('finds tracked files to scan', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  for (const { term, allowedIn } of rules) {
    it(`mentions ${term} only in docs and the tests that prove it is dropped`, () => {
      const offenders = files.filter((f) => {
        if (allowedIn.some((a) => f === a || f.startsWith(a))) return false
        return readFileSync(join(root, f), 'utf8').includes(term)
      })
      expect(offenders).toEqual([])
    })
  }

  it('never reads a credentials file or env token in the Claude Code adapter sources', () => {
    const sources = files.filter((f) => f.startsWith(CLAUDE_CODE_DIR) && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const f of sources) {
      const text = readFileSync(join(root, f), 'utf8')
      expect(text, f).not.toMatch(/process\.env\.(ANTHROPIC|CLAUDE_CODE)_/)
      expect(text, f).not.toMatch(/readFile(Sync)?\(/)
    }
  })
})
