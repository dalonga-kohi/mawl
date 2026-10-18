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

/**
 * Source patterns that would mean Faire touches a Claude login: env tokens (dot or bracket
 * access), any file read or open, the home-directory credential location, and the OS keychains.
 * Returns the names of the patterns that match; empty means clean.
 */
function forbiddenIn(text: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['env token (dot access)', /process\.env\.(ANTHROPIC|CLAUDE_CODE)_/],
    ['env token (bracket access)', /process\.env\[\s*['"`](ANTHROPIC|CLAUDE_CODE)_/],
    ['readFile', /readFile(Sync)?\(/],
    ['createReadStream', /createReadStream\b/],
    ['open', /\b(fs\.)?open(Sync)?\(/],
    ['home .claude directory', /homedir\(\)[^\n]*\.claude/],
    ['macOS keychain', /security\s+find-generic-password/],
    ['libsecret', /secret-tool/],
  ]
  return patterns.filter(([, re]) => re.test(text)).map(([name]) => name)
}

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

  it('never reads a credentials file, keychain entry or env token in the Claude Code adapter sources', () => {
    const sources = files.filter((f) => f.startsWith(CLAUDE_CODE_DIR) && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(0)
    for (const f of sources) {
      expect(forbiddenIn(readFileSync(join(root, f), 'utf8')), f).toEqual([])
    }
  })

  describe('forbiddenIn', () => {
    it.each([
      ['dot access to an env token', 'const k = process.env.ANTHROPIC_API_KEY'],
      ['dot access to a Claude Code env var', 'process.env.CLAUDE_CODE_OAUTH_TOKEN'],
      ['bracket access, single quotes', "process.env['ANTHROPIC_API_KEY']"],
      ['bracket access, double quotes', 'process.env["CLAUDE_CODE_OAUTH_TOKEN"]'],
      ['bracket access with spaces', "process.env[ 'ANTHROPIC_AUTH_TOKEN' ]"],
      ['readFile', "await readFile(join(dir, 'x'))"],
      ['readFileSync', "readFileSync('/x')"],
      ['createReadStream', "createReadStream('/x')"],
      ['fs.open', "const h = await fs.open('/x')"],
      ['open from fs/promises', "const h = await open('/x', 'r')"],
      ['openSync', "openSync('/x', 'r')"],
      ['homedir with .claude', "join(homedir(), '.claude')"],
      ['os.homedir with .claude', "path.join(os.homedir(), '.claude', 'x')"],
      ['macOS keychain read', "execFile('security find-generic-password -s x')"],
      ['libsecret read', "execFile('secret-tool', ['lookup'])"],
    ])('flags %s', (_name, snippet) => {
      expect(forbiddenIn(snippet)).not.toEqual([])
    })

    it.each([
      ['an env allowlist by variable name', "const ALLOW = ['PATH', 'HOME', 'CLAUDE_CONFIG_DIR']"],
      ['a Map named open', 'const open = new Map(); open.get(1)'],
      ['homedir without .claude', 'const home = homedir()'],
      ['reading a non-secret env var', "process.env['PATH']"],
    ])('allows %s', (_name, snippet) => {
      expect(forbiddenIn(snippet)).toEqual([])
    })
  })
})
