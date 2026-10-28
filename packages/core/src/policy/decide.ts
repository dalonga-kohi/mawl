import {
  type ActionClass,
  type Json,
  type NodeKind,
  type PolicyLevel,
  type PolicyMatch,
  type PolicyMode,
  type PolicySource,
  ProfilePolicy,
  type RunTrigger,
} from '@mawl/contracts'
import { normalizeHost, urlHost } from './host.ts'
import { commandPrefixMatch, globMatch } from './match.ts'

/** A rule as the engine reads it (a profile policy rule, or a stored `PolicyRule`). */
export interface PolicyRuleLike {
  match: PolicyMatch
  level: PolicyLevel
}

/**
 * The folder-grant check for a `this_pc` file tool, done by the caller (D3.H1 seam). `inside` is
 * true only when the canonical path lies inside a grant; `writes` is that grant's write level.
 */
export interface GrantCheck {
  inside: boolean
  writes?: 'ask' | 'auto'
}

/** Everything the engine needs to decide one call. Pure data: `decide` does no I/O. */
export interface PolicyInput {
  tool: string
  /** Set for MCP tools (`mcp__<server>__<tool>`). */
  mcpServer?: string
  /** The MCP tool's read-only annotation (a hint only). */
  readOnlyHint?: boolean
  actionClass: ActionClass
  /** The parsed, unredacted arguments (never shown to anyone; the event gets the redacted ones). */
  args: Json
  /** Where the tool runs. `none` for built-ins that touch no node (web, memory, owner contact). */
  nodeKind: NodeKind | 'none'
  trigger: RunTrigger
  /** `this_pc` file tools only. Missing means outside every grant. */
  grant?: GrantCheck
  mode: PolicyMode
  /** `web_fetch` only: an earlier allowed fetch in this run went to the same host. */
  hostSeenInRun?: boolean
}

/** The owner's rule tiers plus the `web_fetch` allow list. Global defaults are built in. */
export interface PolicyConfig {
  /** The owner's rules for this profile (`profiles.policy_json.rules`). */
  userRules: readonly PolicyRuleLike[]
  /** Profile defaults (none ship yet; a seam for per-teammate templates). */
  profileRules: readonly PolicyRuleLike[]
  /** Owner-approved `web_fetch` hosts, as typed (normalized here). */
  allowedHosts: readonly string[]
}

export interface PolicyDecision {
  level: PolicyLevel
  source: PolicySource
  /** Mawl's own words, safe to show the model and the owner. */
  reason: string
}

const RANK: Record<PolicyLevel, number> = { auto: 0, ask: 1, handoff: 2, block: 3 }
const stricter = (a: PolicyLevel, b: PolicyLevel) => (RANK[a] >= RANK[b] ? a : b)

/** Global defaults per action class (ARCHITECTURE section 5; SPEC F12). */
const CLASS_DEFAULTS: Record<ActionClass, PolicyLevel> = {
  read: 'auto',
  owner_contact: 'auto',
  write_local: 'ask',
  send_message: 'ask',
  external_post: 'ask',
  delete: 'ask',
  shell_exec: 'ask',
  credential: 'handoff',
  purchase: 'handoff',
}

/** Classes a teammate-triggered run may still get `auto` for (R19). */
const TEAMMATE_AUTO: ReadonlySet<ActionClass> = new Set(['read', 'owner_contact'])

/** `this_pc` classes confined by folder grants. The shell is not (R16). */
const GRANT_BOUND: ReadonlySet<ActionClass> = new Set(['read', 'write_local', 'delete'])

type Step = PolicyDecision & { final?: boolean }

const floorBlock = (reason: string): Step => ({
  level: 'block',
  source: 'floor',
  reason,
  final: true,
})

function stringArg(args: Json, key: string): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}

/** Url subjects longer than this never match an `argPattern` (the web_fetch input cap). */
export const MAX_URL_SUBJECT_CHARS = 2048

/**
 * A url split where a glob star must not cross: `origin` is `scheme://host[:port]` (never
 * credentials, path, query or fragment), `rest` is the path plus query (no fragment).
 */
type Subject = { kind: 'text'; value: string } | { kind: 'url'; origin: string; rest: string }

/**
 * What an `argPattern` is matched against: the tool's primary argument, the first of `command`,
 * `url` (parsed with the WHATWG parser) or `path`. A tool without one, or a url that does not
 * parse or is longer than `MAX_URL_SUBJECT_CHARS`, never matches a pattern (the stricter outcome:
 * no rule lowers it).
 */
function subjectOf(args: Json): Subject | undefined {
  const command = stringArg(args, 'command')
  if (command !== undefined) return { kind: 'text', value: command }
  const url = stringArg(args, 'url')
  if (url !== undefined) {
    if (url.length > MAX_URL_SUBJECT_CHARS) return undefined
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return undefined
    }
    if (u.href.length > MAX_URL_SUBJECT_CHARS) return undefined
    return { kind: 'url', origin: `${u.protocol}//${u.host}`, rest: `${u.pathname}${u.search}` }
  }
  const path = stringArg(args, 'path')
  return path === undefined ? undefined : { kind: 'text', value: path }
}

/**
 * A url pattern is split like the url: the part up to the first `/` after `://` is matched
 * against `scheme://host[:port]` only, the rest (default `/`) against path plus query. So a star
 * in the host part can never reach into the path or query (`https://*.example.com/*` does not
 * match `https://evil.net/?.example.com/`). A pattern without `://` never matches a url.
 */
function urlGlobMatch(pattern: string, origin: string, rest: string): boolean {
  const sep = pattern.indexOf('://')
  if (sep < 0) return false
  const slash = pattern.indexOf('/', sep + 3)
  const patOrigin = slash < 0 ? pattern : pattern.slice(0, slash)
  const patRest = slash < 0 ? '/' : pattern.slice(slash)
  return globMatch(patOrigin, origin) && globMatch(patRest, rest)
}

/** The built-in default, including the hard floors that end the decision (`final`). */
function globalDefault(input: PolicyInput, config: PolicyConfig): Step {
  if (input.tool === 'web_fetch' && input.mcpServer === undefined) {
    const url = stringArg(input.args, 'url')
    const host = url === undefined ? { kind: 'invalid' as const } : urlHost(url)
    if (host.kind === 'invalid') {
      return floorBlock('Only http and https urls without credentials can be fetched.')
    }
    if (host.kind === 'local') {
      return floorBlock('Addresses on this computer or the local network are never fetched.')
    }
    const allowed = config.allowedHosts.some((h) => normalizeHost(h) === host.host)
    if (allowed) {
      return { level: 'auto', source: 'user_rule', reason: `${host.host} is on the allowed hosts.` }
    }
    if (input.hostSeenInRun) {
      return {
        level: 'auto',
        source: 'global',
        reason: `${host.host} was already fetched in this run.`,
      }
    }
    return {
      level: 'ask',
      source: 'global',
      reason: `First fetch to ${host.host} in this run: the url can carry data out.`,
    }
  }

  if (input.nodeKind === 'this_pc' && GRANT_BOUND.has(input.actionClass)) {
    if (input.grant?.inside !== true) {
      return floorBlock('The path is outside the folders granted on this PC.')
    }
    if (input.actionClass === 'write_local' && input.grant.writes === 'auto') {
      return { level: 'auto', source: 'user_rule', reason: 'The folder grant allows writes.' }
    }
    return {
      level: CLASS_DEFAULTS[input.actionClass],
      source: 'global',
      reason: `Default for ${input.actionClass} inside a folder grant.`,
    }
  }

  if (input.mcpServer !== undefined) {
    // A read-only annotation is a hint only, so it lowers nothing but a tool classified as a read.
    return input.readOnlyHint === true && input.actionClass === 'read'
      ? { level: 'auto', source: 'global', reason: 'A read-only connection tool.' }
      : { level: 'ask', source: 'global', reason: 'Connection tools ask until classified.' }
  }

  return {
    level: CLASS_DEFAULTS[input.actionClass],
    source: 'global',
    reason: `Default for ${input.actionClass}.`,
  }
}

/** `subject` is `subjectOf(input.args)`, computed once per decision. */
function matches(m: PolicyMatch, input: PolicyInput, subject: Subject | undefined): boolean {
  if (m.tool !== undefined && m.tool !== input.tool) return false
  if (m.mcpServer !== undefined && m.mcpServer !== input.mcpServer) return false
  if (m.actionClass !== undefined && m.actionClass !== input.actionClass) return false
  if (m.nodeKind !== undefined && m.nodeKind !== input.nodeKind) return false
  if (m.argPattern !== undefined) {
    if (subject === undefined) return false
    if (subject.kind === 'url') {
      return (
        input.actionClass !== 'shell_exec' &&
        urlGlobMatch(m.argPattern, subject.origin, subject.rest)
      )
    }
    return input.actionClass === 'shell_exec'
      ? commandPrefixMatch(m.argPattern, subject.value)
      : globMatch(m.argPattern, subject.value)
  }
  return true
}

/** Most specific first: exact tool, then MCP server, then action class; then qualifiers. */
function specificity(m: PolicyMatch): [number, number] {
  const primary =
    m.tool !== undefined ? 3 : m.mcpServer !== undefined ? 2 : m.actionClass !== undefined ? 1 : 0
  const qualifiers = (m.nodeKind !== undefined ? 1 : 0) + (m.argPattern !== undefined ? 1 : 0)
  return [primary, qualifiers]
}

/** The winning rule of one tier: most specific, ties to the stricter level. */
function pick(
  rules: readonly PolicyRuleLike[],
  input: PolicyInput,
  subject: Subject | undefined,
): PolicyRuleLike | undefined {
  let best: PolicyRuleLike | undefined
  let bestSpec: [number, number] = [-1, -1]
  for (const rule of rules) {
    if (!matches(rule.match, input, subject)) continue
    const spec = specificity(rule.match)
    const cmp = spec[0] - bestSpec[0] || spec[1] - bestSpec[1]
    if (best === undefined || cmp > 0 || (cmp === 0 && RANK[rule.level] > RANK[best.level])) {
      best = rule
      bestSpec = spec
    }
  }
  return best
}

function fromRule(rule: PolicyRuleLike, input: PolicyInput, source: PolicySource): PolicyDecision {
  // A shell command is lowered below ask only by a rule that names its exact command prefix (R16).
  if (
    input.actionClass === 'shell_exec' &&
    rule.level === 'auto' &&
    rule.match.argPattern === undefined
  ) {
    return {
      level: 'ask',
      source,
      reason: 'Shell commands run without asking only through a command-prefix rule.',
    }
  }
  return {
    level: rule.level,
    source,
    reason: `A ${source === 'user_rule' ? 'rule you set' : 'profile rule'} sets ${rule.level}.`,
  }
}

/**
 * The policy engine: one pure decision per tool call (ARCHITECTURE section 5, Policy engine).
 *
 * 1. Hard floors end the decision with `block`: a `web_fetch` url that is invalid, carries
 *    credentials or points at this computer or the local network; a `this_pc` file call outside
 *    the folder grants.
 * 2. Tiers: the owner's rules, then the allow list (`web_fetch`), then profile rules, then the
 *    built-in defaults. In a tier the most specific rule wins (tool, then MCP server, then action
 *    class; a node kind or argPattern breaks ties); equal ones go to the stricter level.
 * 3. Autopilot lifts an `ask` from the profile or global tier to `auto`, never an owner-written
 *    `ask`, a `delete`, or anything in a teammate-triggered run.
 * 4. Clamps, last, so nothing above can lower them: `credential` and `purchase` at least
 *    `handoff`; `delete` at least `ask`; in a teammate-triggered run (R19) every class but `read`
 *    and `owner_contact` at least `ask`.
 */
export function decide(input: PolicyInput, config: PolicyConfig): PolicyDecision {
  const base = globalDefault(input, config)
  if (base.final) return { level: base.level, source: base.source, reason: base.reason }

  let d: PolicyDecision
  const subject = subjectOf(input.args)
  const userRule = pick(config.userRules, input, subject)
  const profileRule = userRule ? undefined : pick(config.profileRules, input, subject)
  if (userRule) d = fromRule(userRule, input, 'user_rule')
  else if (base.source === 'user_rule') d = base
  else if (profileRule) d = fromRule(profileRule, input, 'profile')
  else d = { level: base.level, source: base.source, reason: base.reason }

  const teammate = input.trigger === 'teammate'
  if (
    input.mode === 'autopilot' &&
    d.level === 'ask' &&
    d.source !== 'user_rule' &&
    input.actionClass !== 'delete' &&
    !teammate
  ) {
    d = { level: 'auto', source: 'autopilot', reason: 'Autopilot runs this without asking.' }
  }

  const clamp = (min: PolicyLevel, reason: string) => {
    if (stricter(d.level, min) !== d.level) d = { level: min, source: 'floor', reason }
  }
  if (input.actionClass === 'credential' || input.actionClass === 'purchase') {
    clamp('handoff', `${input.actionClass} actions are always handed to you.`)
  }
  if (input.actionClass === 'delete') clamp('ask', 'Deleting always asks first.')
  if (teammate && !TEAMMATE_AUTO.has(input.actionClass)) {
    clamp('ask', "A teammate's request never carries your approval.")
  }
  return d
}

/**
 * Reads `profiles.policy_json`. Anything invalid becomes the default policy (standard mode, no
 * rules, no allowed hosts): fail closed, never Autopilot and never allow-all.
 */
export function parseProfilePolicy(raw: unknown): { policy: ProfilePolicy; valid: boolean } {
  const parsed = ProfilePolicy.safeParse(raw)
  if (parsed.success) return { policy: parsed.data, valid: true }
  return { policy: ProfilePolicy.parse({}), valid: false }
}
