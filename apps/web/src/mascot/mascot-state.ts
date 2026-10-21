import type { RunStatus } from '@mawl/contracts'
import { useEffect, useRef, useState } from 'react'
import type { MascotState } from './Beaver.tsx'

export interface MascotInputs {
  /** Status of the run the owner is looking at, if any. */
  run?: RunStatus | undefined
  /** Tool calls are executing (P2 tools); generating text is thinking. */
  toolsRunning?: boolean
  /** The owner is typing in the composer. */
  typing?: boolean
  /** The run reached its end moments ago (done or error play, then idle). */
  justEnded?: boolean
}

/** DESIGN.md §8 states from what the owner can see. Pure: timing lives in {@link useMascotState}. */
export function deriveMascotState({
  run,
  toolsRunning,
  typing,
  justEnded,
}: MascotInputs): MascotState {
  switch (run) {
    case 'queued':
      return 'thinking'
    case 'running':
      return toolsRunning ? 'working' : 'thinking'
    case 'compacting':
      return 'working'
    case 'waiting_approval':
    case 'waiting_takeover':
    case 'waiting_user':
      return 'waiting'
    case 'paused':
      return 'sleeping'
    case 'succeeded':
      if (justEnded) return 'done'
      break
    case 'failed':
      if (justEnded) return 'error'
      break
    default:
      break
  }
  return typing ? 'listening' : 'idle'
}

/** How long "done" and "error" play before Pip settles back to idle. */
export const END_POSE_MS = 2400

/**
 * The mascot state for the current run. A run that ends while watched plays its end pose for
 * {@link END_POSE_MS}; a run that was already over when the view opened does not.
 */
export function useMascotState(inputs: Omit<MascotInputs, 'justEnded'>): MascotState {
  const [justEnded, setJustEnded] = useState(false)
  const previous = useRef(inputs.run)
  useEffect(() => {
    const before = previous.current
    previous.current = inputs.run
    const ended = inputs.run === 'succeeded' || inputs.run === 'failed'
    const wasActive = before !== undefined && before !== inputs.run && !isEnd(before)
    if (!ended || !wasActive) return
    setJustEnded(true)
    const timer = setTimeout(() => setJustEnded(false), END_POSE_MS)
    return () => clearTimeout(timer)
  }, [inputs.run])
  return deriveMascotState({ ...inputs, justEnded })
}

const isEnd = (s: RunStatus) => s === 'succeeded' || s === 'failed' || s === 'cancelled'
