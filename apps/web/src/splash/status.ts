import { z } from 'zod'
import type { MascotState } from '../mascot/states.ts'

/**
 * The desktop host's supervisor status (Rust `mawl_host::machine::Status`), as it arrives over
 * Tauri IPC. Parsed at the boundary: anything unknown falls back to the starting screen.
 */
const FailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('spawn_failed') }),
  z.object({ kind: z.literal('exited'), code: z.number().int().nullable() }),
  z.object({ kind: z.literal('unhealthy') }),
  z.object({ kind: z.literal('boot_timeout') }),
  z.object({ kind: z.literal('not_installed') }),
])
export type Failure = z.infer<typeof FailureSchema>

export const StatusSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('starting'), stage: z.enum(['database', 'server']) }),
  z.object({ phase: z.literal('ready') }),
  z.object({
    phase: z.literal('restarting'),
    attempt: z.number().int().min(1),
    reason: FailureSchema,
    retry_in_ms: z.number().int().nonnegative().nullable(),
  }),
  z.object({ phase: z.literal('stopping') }),
  z.object({ phase: z.literal('stopped') }),
  z.object({ phase: z.literal('failed'), reason: FailureSchema }),
])
export type Status = z.infer<typeof StatusSchema>

export const INITIAL_STATUS: Status = { phase: 'starting', stage: 'database' }

export function parseStatus(value: unknown): Status {
  const parsed = StatusSchema.safeParse(value)
  return parsed.success ? parsed.data : INITIAL_STATUS
}

/** Restarts allowed in five minutes before the host gives up (`MAX_RESTARTS`). */
export const MAX_RESTARTS = 5

/** The three steps of the progress track. */
export const STEPS = ['Database', 'Server', 'Ready'] as const

export interface View {
  mascot: MascotState
  title: string
  detail: string
  /** Steps finished (0-3); `undefined` hides the track. */
  done?: number
  /** True when the step after `done` is in progress. */
  active?: boolean
  /** The failed screen with its actions. */
  failed?: boolean
  /** The failed screen's one primary action. */
  next?: 'retry' | 'quit'
  /** A restart in progress: the ring pulses and shows which try it is. */
  retry?: { attempt: number; of: number }
}

function why(reason: Failure): string {
  switch (reason.kind) {
    case 'exited':
      return 'The Mawl server stopped unexpectedly.'
    case 'unhealthy':
      return 'The Mawl server lost its database.'
    case 'boot_timeout':
      return 'The Mawl server took too long to start.'
    case 'spawn_failed':
      return 'The Mawl server could not be started.'
    case 'not_installed':
      return 'Some of Mawl’s files are missing.'
  }
}

/** What the splash shows for a status. Plain words, no system terms. */
export function describe(status: Status): View {
  switch (status.phase) {
    case 'starting':
      return status.stage === 'database'
        ? {
            mascot: 'thinking',
            title: 'Waking up',
            detail: 'Starting the database',
            done: 0,
            active: true,
          }
        : {
            mascot: 'working',
            title: 'Almost there',
            detail: 'Starting the Mawl server',
            done: 1,
            active: true,
          }
    case 'ready':
      return { mascot: 'done', title: 'Ready', detail: 'Opening Mawl', done: 3 }
    case 'restarting':
      return {
        mascot: 'thinking',
        title: 'Restarting',
        detail: `${why(status.reason)} Starting it again (try ${status.attempt} of ${MAX_RESTARTS}).`,
        done: 0,
        active: true,
        retry: { attempt: status.attempt, of: MAX_RESTARTS },
      }
    case 'stopping':
      return {
        mascot: 'sleepy',
        title: 'Closing Mawl',
        detail: 'Stopping the server and the database',
      }
    case 'stopped':
      return { mascot: 'sleepy', title: 'Mawl is closed', detail: 'See you soon' }
    case 'failed':
      return status.reason.kind === 'not_installed'
        ? {
            mascot: 'oops',
            title: 'Mawl can’t start',
            detail: `${why(status.reason)} Reinstall Mawl to fix this.`,
            failed: true,
            next: 'quit',
          }
        : {
            mascot: 'oops',
            title: 'Mawl can’t start',
            detail: `${why(status.reason)} Mawl restarted it ${MAX_RESTARTS} times, then stopped.`,
            failed: true,
            next: 'retry',
          }
  }
}
