import type { NodeKind, ProfileId, RunId, RunTrigger } from '@mawl/contracts'
import type { ToolGate, ToolGateDecision } from '../tools/types.ts'
import { decide, type PolicyRuleLike, parseProfilePolicy } from './decide.ts'
import { urlHost } from './host.ts'

/** What the gate needs about a run, loaded fresh for every call (so a policy edit applies at once). */
export interface PolicyGateContext {
  /** The profile's raw `policy_json`; parsed here, invalid falls back to the default policy. */
  policy: unknown
  trigger: RunTrigger
  /** Where the run's tools execute. Default `none` (no node tools exist before D3.H1). */
  nodeKind?: NodeKind | 'none'
}

export interface PolicyGateDeps {
  load(bind: { runId: RunId; profileId: ProfileId }): Promise<PolicyGateContext>
  /**
   * Hosts this run already fetched with an allowed `web_fetch`, read from the run's recorded
   * `run.tool_call` events (see `hostsFromToolCalls`), so the answer survives a job restart.
   * Called for `web_fetch` only.
   */
  seenHosts(runId: RunId): Promise<readonly string[]>
  /** Profile default rules (none ship yet). */
  profileRules?: readonly PolicyRuleLike[]
  /** The stored policy was invalid; the default policy was used. Log it, never the value. */
  onInvalidPolicy?(profileId: ProfileId): void
  /** `load` threw; the call was decided with the default policy and the strictest trigger. */
  onLoadError?(error: unknown): void
}

/** Prefix of MCP tool names (`mcp__<server>__<tool>`, ARCHITECTURE section 5). */
const MCP_PREFIX = 'mcp__'

function mcpServerOf(tool: string): string | undefined {
  if (!tool.startsWith(MCP_PREFIX)) return undefined
  const end = tool.indexOf('__', MCP_PREFIX.length)
  return end > MCP_PREFIX.length ? tool.slice(MCP_PREFIX.length, end) : undefined
}

/**
 * The hosts of allowed (`level: 'auto'`) `web_fetch` calls among `run.tool_call` payloads. Denied
 * or pre-D2.3 calls (no level) never count, so a refused fetch cannot unlock its host.
 */
export function hostsFromToolCalls(payloads: readonly unknown[]): string[] {
  const out = new Set<string>()
  for (const p of payloads) {
    if (p === null || typeof p !== 'object') continue
    const e = p as { tool?: unknown; level?: unknown; argsRedacted?: unknown }
    if (e.tool !== 'web_fetch' || e.level !== 'auto') continue
    const args = e.argsRedacted
    if (args === null || typeof args !== 'object') continue
    const url = (args as { url?: unknown }).url
    if (typeof url !== 'string') continue
    const host = urlHost(url)
    if (host.kind === 'public') out.add(host.host)
  }
  return [...out]
}

/** Until approvals land (D2.4), a call that needs the owner is refused with this note. */
const NO_APPROVALS_YET =
  'Approvals and hand-offs are not available yet, so calls that need the owner are not run.'

/**
 * The policy engine as the registry's `ToolGate`. Per call: load the run's context, parse the
 * profile policy (invalid: defaults), look up seen hosts for `web_fetch`, `decide`, and map the
 * level: `auto` allows; `block` denies; `ask` and `handoff` deny with a note until D2.4 turns
 * them into `park`. Any failure to load fails closed: default policy, trigger `teammate`.
 */
export function policyGate(deps: PolicyGateDeps): ToolGate {
  return {
    async check(req): Promise<ToolGateDecision> {
      let ctx: PolicyGateContext
      try {
        ctx = await deps.load({ runId: req.runId, profileId: req.profileId })
      } catch (err) {
        deps.onLoadError?.(err)
        ctx = { policy: {}, trigger: 'teammate' }
      }
      const { policy, valid } = parseProfilePolicy(ctx.policy)
      if (!valid) deps.onInvalidPolicy?.(req.profileId)

      let hostSeenInRun = false
      if (req.tool === 'web_fetch') {
        const url =
          req.args !== null && typeof req.args === 'object' && !Array.isArray(req.args)
            ? req.args.url
            : undefined
        const host = typeof url === 'string' ? urlHost(url) : null
        if (host?.kind === 'public') {
          try {
            hostSeenInRun = (await deps.seenHosts(req.runId)).includes(host.host)
          } catch {
            // Unknown: ask again rather than assume.
            hostSeenInRun = false
          }
        }
      }

      const mcpServer = mcpServerOf(req.tool)
      const d = decide(
        {
          tool: req.tool,
          ...(mcpServer !== undefined ? { mcpServer } : {}),
          actionClass: req.actionClass,
          args: req.args,
          nodeKind: ctx.nodeKind ?? 'none',
          trigger: ctx.trigger,
          mode: policy.mode,
          hostSeenInRun,
        },
        {
          userRules: policy.rules,
          profileRules: deps.profileRules ?? [],
          allowedHosts: policy.allowedHosts,
        },
      )
      const audit = {
        level: d.level,
        source: d.source,
        ...(policy.mode === 'autopilot' ? { mode: 'autopilot' as const } : {}),
      }
      if (d.level === 'auto') return { decision: 'allow', audit }
      if (d.level === 'block') return { decision: 'deny', reason: d.reason, audit }
      return { decision: 'deny', reason: `${d.reason} ${NO_APPROVALS_YET}`, audit }
    },
  }
}
