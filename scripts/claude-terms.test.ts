import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Anthropic's terms allow a Claude subscription only through Claude Code's own sign-in flow
 * (code.claude.com/docs/en/legal-and-compliance). Mawl therefore never reads, copies or parses
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
// The repo's own CI runs Anthropic's claude-code-action with a token from `claude setup-token`.
// That is Claude Code's own flow on GitHub, not Mawl touching a login, so only this file may
// name the token.
const CLAUDE_WORKFLOW = '.github/workflows/claude.yml'

const rules: Array<{ term: string; allowedIn: string[] }> = [
  // The credential file and the keychain entry belong to the binary alone.
  { term: '.credentials.json', allowedIn: [SELF, ...DOCS] },
  { term: 'Claude Code-credentials', allowedIn: [SELF, ...DOCS] },
  { term: 'setup-token', allowedIn: [SELF, ...DOCS, CLAUDE_WORKFLOW] },
  // Dropped from the subprocess env; named only where tests prove it.
  {
    term: 'CLAUDE_CODE_OAUTH_TOKEN',
    allowedIn: [SELF, ...DOCS, CLAUDE_CODE_DIR, CLAUDE_WORKFLOW],
  },
]

/**
 * Source patterns that would mean Mawl touches a Claude login: env tokens (dot or bracket
 * access), any file read or open, the home-directory credential location, and the OS keychains.
 * Returns the names of the patterns that match; empty means clean.
 */
function forbiddenIn(rawText: string, file = ''): string[] {
  // Comments may name what the code must not do; only code is scanned. This stripper is a
  // heuristic: a `//` or `/*` inside a string can fool it. The guard catches accidents and drift,
  // not an adversary; code review covers the rest.
  const text = rawText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  const patterns: Array<[string, RegExp]> = [
    ['env token (dot access)', /process\.env\.(ANTHROPIC|CLAUDE_CODE)_/],
    ['env token (bracket access)', /process\.env\[\s*['"`](ANTHROPIC|CLAUDE_CODE)_/],
    // An alias, a destructure or the whole object passed on hides which variables are read.
    ['whole process.env', /process\.env\b(?!\.\w|\s*\[)/],
    ['env via destructured process', /\{[^}]*\benv\b[^}]*\}\s*=\s*process\b(?!\.)/],
    ['env via the process module', /(from|require\()\s*['"](node:)?process['"]/],
    ['process via globalThis', /globalThis(\.process\b|\s*\[\s*['"]process['"])/],
    ['readFile', /readFile(Sync)?\(/],
    ['createReadStream', /createReadStream\b/],
    ['open', /\b(fs\.)?open(Sync)?\(/],
    ['copy or list files', /\b(copyFile|readdir|cp)(Sync)?\(/],
    ['macOS keychain', /find-generic-password/],
    ['OS credential stores', /\bkeytar\b|cmdkey|CredRead|secret-tool/],
  ]
  const hits = patterns
    .filter(([name, re]) => re.test(text) && !EXEMPT[file]?.includes(name))
    .map(([name]) => name)
  // File-level, so the two can be on different lines: the home dir plus the .claude directory.
  if (/homedir/.test(text) && /\.claude/.test(text)) hits.push('home .claude directory')
  return hits
}

/**
 * The one legitimate use: env.ts defaults its allowlist input to `process.env` and copies only
 * the allowed names out of it. Exempt by exact file and pattern, never globally.
 */
const EXEMPT: Record<string, string[]> = {
  [`${CLAUDE_CODE_DIR}env.ts`]: ['whole process.env'],
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
      expect(forbiddenIn(readFileSync(join(root, f), 'utf8'), f), f).toEqual([])
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
      ['keychain via execFile args', "execFile('security', ['find-generic-password', '-s', 'x'])"],
      ['keytar', "import keytar from 'keytar'"],
      ['cmdkey', "execFile('cmdkey', ['/list'])"],
      ['CredRead', 'CredReadW(target)'],
      ['env alias', 'const env = process.env'],
      ['env destructure', 'const { HOME, ANTHROPIC_API_KEY } = process.env'],
      ['env passed whole', 'spawn(cmd, { env: process.env })'],
      ['env spread', 'const e = { ...process.env }'],
      ['env destructured from process', 'const { env } = process'],
      ['env destructured with others', 'const { cwd, env: e } = process;'],
      ['env imported from node:process', "import { env } from 'node:process'"],
      ['env imported from process', 'import { env } from "process"'],
      ['process required', "const p = require('node:process')"],
      ['globalThis.process', 'const e = globalThis.process.env'],
      ['globalThis["process"]', "const e = globalThis['process']"],
      ['copyFile', "await copyFile('/a', '/b')"],
      ['readdir', "await readdir('/x')"],
      ['cp', "await cp('/a', '/b', { recursive: true })"],
      ['homedir and .claude on different lines', "const h = homedir()\nconst d = '.claude'"],
    ])('flags %s', (_name, snippet) => {
      expect(forbiddenIn(snippet)).not.toEqual([])
    })

    it('exempts only the env allowlist builder, and only for the whole-env pattern', () => {
      const dflt = '{ env = process.env }'
      const envFile = `${CLAUDE_CODE_DIR}env.ts`
      expect(forbiddenIn(dflt, envFile)).toEqual([])
      expect(forbiddenIn(dflt, `${CLAUDE_CODE_DIR}model.ts`)).not.toEqual([])
      expect(forbiddenIn("process.env['ANTHROPIC_API_KEY']", envFile)).not.toEqual([])
    })

    it('ignores comments', () => {
      expect(forbiddenIn('// uses process.env and readFile( and homedir .claude')).toEqual([])
      expect(forbiddenIn('/** Defaults to `process.env`. */\nconst x = 1')).toEqual([])
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
