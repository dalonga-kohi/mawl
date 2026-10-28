import { POLICY_LIMITS } from '@mawl/contracts'

/** Subjects (a command, url or path) longer than this never match an `argPattern`. */
export const MAX_SUBJECT_CHARS = 4096

/**
 * Anchored glob match: `*` matches any run of characters (including none), every other character
 * matches itself, case-sensitive. Never a regular expression, so an owner-written pattern cannot
 * cause catastrophic backtracking: the loop below keeps one backtrack point, so the worst case is
 * pattern length x subject length steps (200 x 4096).
 */
export function globMatch(pattern: string, subject: string): boolean {
  if (pattern.length > POLICY_LIMITS.argPatternChars || subject.length > MAX_SUBJECT_CHARS) {
    return false
  }
  let p = 0
  let s = 0
  let star = -1
  let mark = 0
  while (s < subject.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p++
      mark = s
    } else if (p < pattern.length && pattern[p] === subject[s]) {
      p++
      s++
    } else if (star !== -1) {
      p = star + 1
      s = ++mark
    } else {
      return false
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++
  return p === pattern.length
}

/**
 * Characters a command may contain for a prefix rule to apply: printable ASCII without anything a
 * shell (PowerShell, cmd or sh) treats as an operator, substitution, redirection, grouping, escape
 * or variable expansion. Anything else (`;`, `&`, `|`, newlines, backticks, `$`, `%`, `!`, `^`,
 * `<`, `>`, brackets, braces, non-ASCII) keeps the command at `ask`. An allow list, not a deny list,
 * so an operator nobody thought of is refused by default.
 */
const SIMPLE_COMMAND = /^[A-Za-z0-9 \t_\-.,/\\:=@+~'"]+$/

/**
 * True when `command` starts with the literal `prefix` on a token boundary (`git status` matches
 * `git status -s`, never `git statusx`), and both are simple commands (see `SIMPLE_COMMAND`), so a
 * chained `git status; rm x` never inherits a `git status` rule. The prefix has no wildcards.
 */
export function commandPrefixMatch(prefix: string, command: string): boolean {
  if (prefix === '' || prefix.length > POLICY_LIMITS.argPatternChars) return false
  if (command.length > MAX_SUBJECT_CHARS) return false
  if (prefix.trim() !== prefix) return false
  if (!SIMPLE_COMMAND.test(prefix) || !SIMPLE_COMMAND.test(command)) return false
  if (command === prefix) return true
  if (!command.startsWith(prefix)) return false
  const next = command[prefix.length]
  return next === ' ' || next === '\t'
}
