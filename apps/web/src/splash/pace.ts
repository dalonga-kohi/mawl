import { useEffect, useState } from 'react'
import type { Status } from './status.ts'

/**
 * The splash's beats (U14). Real status drives the show, but a fast boot would flash Database,
 * Server and Ready past in a few frames. Forward progress is therefore held so each step is on
 * screen for at least {@link MIN_BEAT_MS}, and a skipped step is walked through, not jumped over.
 * Everything that is not forward progress (a failure, a restart, stopping) shows at once: the
 * owner must never wait on an animation to learn that something went wrong.
 */
export const MIN_BEAT_MS = 600

/** Database 0, Server 1, Ready 2; `undefined` for anything that is not a boot step. */
function rank(status: Status): number | undefined {
  if (status.phase === 'ready') return 2
  if (status.phase === 'starting') return status.stage === 'database' ? 0 : 1
  return undefined
}

const STEP_AT: readonly Status[] = [
  { phase: 'starting', stage: 'database' },
  { phase: 'starting', stage: 'server' },
  { phase: 'ready' },
]

/** The next status to show on the way from `shown` to `target`: one step at a time going forward. */
export function nextBeat(shown: Status, target: Status): Status {
  const from = rank(shown)
  const to = rank(target)
  if (from === undefined || to === undefined || to <= from + 1) return target
  return STEP_AT[from + 1] ?? target
}

/** How long `next` waits after `shown` has been up for `elapsedMs`: only forward progress waits. */
export function beatDelay(shown: Status, next: Status, elapsedMs: number): number {
  const from = rank(shown)
  const to = rank(next)
  if (from === undefined || to === undefined || to <= from) return 0
  return Math.max(0, MIN_BEAT_MS - elapsedMs)
}

const same = (a: Status, b: Status) => JSON.stringify(a) === JSON.stringify(b)

/**
 * `latest` as the owner should see it: the first status at once, then forward progress paced by
 * {@link nextBeat} and {@link beatDelay}. `undefined` until the host said something.
 */
export function usePacedStatus(latest: Status | undefined): Status | undefined {
  const [beat, setBeat] = useState<{ status: Status; since: number } | undefined>(() =>
    latest ? { status: latest, since: Date.now() } : undefined,
  )

  useEffect(() => {
    if (!latest) return
    if (!beat) {
      setBeat({ status: latest, since: Date.now() })
      return
    }
    if (same(beat.status, latest)) return
    const next = nextBeat(beat.status, latest)
    const wait = beatDelay(beat.status, next, Date.now() - beat.since)
    const land = () => setBeat({ status: next, since: Date.now() })
    if (wait === 0) {
      land()
      return
    }
    const timer = setTimeout(land, wait)
    return () => clearTimeout(timer)
  }, [latest, beat])

  return beat?.status
}
