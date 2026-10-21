import type { RunErrorCode, RunStatus } from '@mawl/contracts'

/** Statuses in which a run is still going and the composer offers Stop instead of Send. */
export const ACTIVE_STATUSES: readonly RunStatus[] = [
  'queued',
  'running',
  'waiting_approval',
  'waiting_takeover',
  'waiting_user',
  'compacting',
  'paused',
]

export const isActive = (status: RunStatus | undefined) =>
  status !== undefined && ACTIVE_STATUSES.includes(status)

/** The short header line under a teammate's name. */
export function statusLine(status: RunStatus | undefined, streaming: boolean): string {
  switch (status) {
    case 'queued':
      return 'Getting started'
    case 'running':
      return streaming ? 'Writing' : 'Thinking'
    case 'waiting_approval':
    case 'waiting_takeover':
    case 'waiting_user':
      return 'Waiting for you'
    case 'compacting':
      return 'Tidying up its notes'
    case 'paused':
      return 'Paused'
    default:
      return 'Ready'
  }
}

export interface FailureCopy {
  /** What happened, in one sentence. */
  title: string
  /** How to fix it. */
  hint: string
  /** Where the fix lives, when it is in the app. */
  action?: 'models'
}

/** Plain words for every closed `RunErrorCode`. Never shows provider text: the server never sends any. */
export function failureCopy(code: RunErrorCode | null): FailureCopy {
  switch (code) {
    case 'plan_limit_reached':
      return {
        title: "You've reached your plan's usage limit.",
        hint: 'Try again once it resets, or pick another model in Settings.',
        action: 'models',
      }
    case 'not_eligible':
      return {
        title: "This account can't be used for teammates.",
        hint: 'Check your plan with the provider, or connect another model.',
        action: 'models',
      }
    case 'temporarily_unavailable':
      return {
        title: 'The model provider is busy or down right now.',
        hint: 'Wait a moment and send your message again.',
      }
    case 'unsupported_capability':
      return {
        title: "This model can't do what the request needed.",
        hint: 'Try a different model for this teammate.',
        action: 'models',
      }
    case 'reauth_required':
      return {
        title: 'The sign-in for this model expired.',
        hint: 'Sign in again in Settings, then resend.',
        action: 'models',
      }
    case 'config_error':
      return {
        title: "The model connection isn't set up right.",
        hint: 'Check the connection in Settings.',
        action: 'models',
      }
    case 'plan_usage_disabled':
      return {
        title: "This sign-in can't use the plan for replies.",
        hint: 'Sign in again and allow plan usage.',
        action: 'models',
      }
    case 'model_not_configured':
      return {
        title: 'This teammate has no working model.',
        hint: 'Connect a model in Settings, or pick another one.',
        action: 'models',
      }
    case 'budget_steps':
      return {
        title: 'Stopped after too many steps.',
        hint: 'Break the task into smaller asks and send again.',
      }
    case 'budget_tokens':
      return {
        title: 'Stopped: the reply used up its token budget.',
        hint: 'Ask for something shorter, or split the task.',
      }
    case 'budget_wall_clock':
      return {
        title: 'Stopped: the reply took too long.',
        hint: 'Send it again, or split the task into parts.',
      }
    case 'provider_error':
      return {
        title: 'The model provider returned an error.',
        hint: 'Send your message again. If it keeps happening, check the connection in Settings.',
        action: 'models',
      }
    default:
      return {
        title: 'Something went wrong on the Mawl server.',
        hint: 'Send your message again. The server log has the details.',
      }
  }
}
