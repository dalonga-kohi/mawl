import { z } from 'zod'

export const RunStatus = z.enum([
  'queued',
  'running',
  'waiting_approval',
  'waiting_takeover',
  'waiting_user',
  'compacting',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
])
export type RunStatus = z.infer<typeof RunStatus>

export const RunTrigger = z.enum(['user', 'routine', 'heartbeat', 'teammate'])
export type RunTrigger = z.infer<typeof RunTrigger>

export const StepKind = z.enum(['model', 'tool'])
export type StepKind = z.infer<typeof StepKind>

export const PolicyLevel = z.enum(['auto', 'ask', 'handoff', 'block'])
export type PolicyLevel = z.infer<typeof PolicyLevel>

/** Which tier of the policy engine produced a decision (ARCHITECTURE section 5, Policy engine). */
export const PolicySource = z.enum(['floor', 'user_rule', 'profile', 'global', 'autopilot'])
export type PolicySource = z.infer<typeof PolicySource>

/** A profile's policy mode. Autopilot lifts lowerable `ask` decisions to `auto`, never a floor. */
export const PolicyMode = z.enum(['standard', 'autopilot'])
export type PolicyMode = z.infer<typeof PolicyMode>

/** Where a teammate's tools run (REDESIGN R15). Built-in tools that touch no node have none. */
export const NodeKind = z.enum(['this_pc', 'docker_terminal', 'docker_desktop'])
export type NodeKind = z.infer<typeof NodeKind>

export const ActionClass = z.enum([
  'read',
  'write_local',
  'send_message',
  'purchase',
  'delete',
  'credential',
  'external_post',
  'shell_exec',
  // Talks only to the owner inside Mawl (ask_user, notify): nothing leaves the install.
  'owner_contact',
])
export type ActionClass = z.infer<typeof ActionClass>

/** `cancelled`: the run was cancelled while the approval was pending. */
export const ApprovalStatus = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled'])
export type ApprovalStatus = z.infer<typeof ApprovalStatus>

export const ChannelKind = z.enum(['telegram', 'discord'])
export type ChannelKind = z.infer<typeof ChannelKind>

export const ProviderKind = z.enum([
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
  'openai_compatible',
  // Sign in with ChatGPT: plan usage through OAuth instead of an API key.
  'openai_chatgpt',
  // Claude subscription through the unmodified Claude Code binary, signed in by the owner out of band.
  'anthropic_claude_code',
])
export type ProviderKind = z.infer<typeof ProviderKind>

/**
 * Why a provider call failed, as a closed set the run engine can store and the app can explain.
 * Provider text is never carried: it can echo credentials.
 */
export const ProviderFailureReason = z.enum([
  'plan_limit_reached',
  'not_eligible',
  'temporarily_unavailable',
  'unsupported_capability',
  'reauth_required',
  'config_error',
  'plan_usage_disabled',
  'provider_error',
])
export type ProviderFailureReason = z.infer<typeof ProviderFailureReason>

/**
 * Why a run ended `failed`, as a closed set the app can explain. Every provider failure reason
 * plus the engine's own. Exception and provider text is never stored: it can echo credentials.
 */
export const RunErrorCode = z.enum([
  ...ProviderFailureReason.options,
  'model_not_configured',
  'budget_steps',
  'budget_tokens',
  'budget_wall_clock',
  'internal_error',
])
export type RunErrorCode = z.infer<typeof RunErrorCode>

export const ThemePref = z.enum(['system', 'light', 'dark'])
export type ThemePref = z.infer<typeof ThemePref>

export const MessageRole = z.enum(['user', 'assistant', 'system', 'tool'])
export type MessageRole = z.infer<typeof MessageRole>

/** Run lifecycle edges, transcribed from the ARCHITECTURE section 5 state diagram (users may cancel from any non-terminal state). */
export const RUN_TRANSITIONS = {
  queued: ['running', 'cancelled'],
  running: [
    'waiting_approval',
    'waiting_takeover',
    'waiting_user',
    'compacting',
    'paused',
    'succeeded',
    'failed',
    'cancelled',
  ],
  waiting_approval: ['running', 'cancelled'],
  waiting_takeover: ['running', 'cancelled'],
  waiting_user: ['running', 'cancelled'],
  compacting: ['running', 'failed', 'cancelled'],
  paused: ['queued', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<RunStatus, readonly RunStatus[]>

export const RUN_TERMINAL_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly RunStatus[]

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return (RUN_TRANSITIONS[from] as readonly RunStatus[]).includes(to)
}
