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

export const ActionClass = z.enum([
  'read',
  'write_local',
  'send_message',
  'purchase',
  'delete',
  'credential',
  'external_post',
  'shell_exec',
])
export type ActionClass = z.infer<typeof ActionClass>

export const ApprovalStatus = z.enum(['pending', 'approved', 'denied', 'expired'])
export type ApprovalStatus = z.infer<typeof ApprovalStatus>

export const ChannelKind = z.enum(['telegram', 'discord'])
export type ChannelKind = z.infer<typeof ChannelKind>

export const ProviderKind = z.enum([
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
  'openai_compatible',
])
export type ProviderKind = z.infer<typeof ProviderKind>

export const ThemePref = z.enum(['system', 'light', 'dark'])
export type ThemePref = z.infer<typeof ThemePref>

export const MessageRole = z.enum(['user', 'assistant', 'system', 'tool'])
export type MessageRole = z.infer<typeof MessageRole>

/** Run lifecycle edges, transcribed from the ARCHITECTURE section 5 state diagram. */
export const RUN_TRANSITIONS = {
  queued: ['running'],
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
  waiting_approval: ['running'],
  waiting_takeover: ['running'],
  waiting_user: ['running'],
  compacting: ['running'],
  paused: ['queued'],
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
