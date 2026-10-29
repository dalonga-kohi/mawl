import { durSeconds, ease, spring } from '@mawl/ui'
import { RotateCw } from 'lucide-react'
import { motion, useAnimate, useReducedMotionConfig } from 'motion/react'
import { type Ref, useEffect, useRef, useState } from 'react'
import { type Glyph, GlyphShape } from '../mascot/glyphs.tsx'
import { Mawl } from '../mascot/Mawl.tsx'
import type { MascotState } from '../mascot/states.ts'
import type { OrbWay } from '../mascot/ways.ts'
import { arcPath, type BeadState, beadAngle, beadStates, onRing, RING } from './ring.ts'
import { STEPS } from './status.ts'

/** How long the orb's eyes stay sleepy brackets on a fresh boot before they open. */
export const WAKE_MS = 520
/** The splash orb; the app's entry curtain draws its orb at the same size and spot. */
export const STAGE_ORB = 128

/**
 * What the stage is doing. `progress`: the boot steps; `retry`: a restart (the ring pulses);
 * `failed`: the ring dims and the orb shakes once; `calm`: just the orb (closing, forms);
 * `leaving`: Ready is done, the ring fades and only the orb stays for the app to pick up.
 */
export type StageMode = 'progress' | 'retry' | 'failed' | 'calm' | 'leaving'

const BEAD_GLYPH: Record<(typeof STEPS)[number], Glyph> = {
  Database: 'plus',
  Server: 'star',
  Ready: 'up',
}

/**
 * The splash's protagonist (U14): the orb, with the progress ring and its three glyph beads drawn
 * around it. Real progress drives the ring; each finished step closes an arc, pops its bead and
 * makes the orb hop. Transform and opacity only, apart from the arcs' path length.
 */
export function OrbStage({
  mascot,
  mode,
  progress,
  retry,
  way = 'orange',
  orbRef,
}: {
  mascot: MascotState
  mode: StageMode
  progress?: { done: number; active: boolean; label: string } | undefined
  /** A retry in progress: its number, and the most there will be when that is known. */
  retry?: { attempt: number; of?: number | undefined } | undefined
  way?: OrbWay
  /** The box around the orb, for a hand-off that starts where it is drawn. */
  orbRef?: Ref<HTMLSpanElement>
}) {
  const reduce = useReducedMotionConfig() ?? false
  const waking = useWake(!reduce && mode === 'progress' && (progress?.done ?? 0) === 0)
  const hop = useHopOnStep(progress?.done ?? 0, reduce)
  const showRing = mode !== 'calm'
  const states = progress && mode !== 'failed' ? beadStates(progress.done, progress.active) : null

  return (
    <div
      data-stage=""
      data-mode={mode}
      className="splash-stage relative grid place-items-center"
      style={{ width: RING.box, height: RING.box }}
    >
      {showRing ? (
        <motion.svg
          aria-hidden="true"
          className="splash-ring absolute inset-0"
          viewBox={`0 0 ${RING.box} ${RING.box}`}
          width={RING.box}
          height={RING.box}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{
            opacity: mode === 'leaving' ? 0 : mode === 'failed' ? 0.45 : 1,
            scale: mode === 'leaving' ? 1.06 : 1,
            transition:
              mode === 'leaving' ? { duration: durSeconds.slow, ease: ease.out } : spring.gentle,
          }}
        >
          {STEPS.map((step, i) => (
            <Arc key={step} i={i} state={states?.[i] ?? 'todo'} />
          ))}
          {STEPS.map((step, i) => (
            <Bead key={step} name={step} i={i} state={states?.[i] ?? 'todo'} />
          ))}
        </motion.svg>
      ) : null}
      {progress && states ? (
        <span
          role="progressbar"
          aria-label="Starting Mawl"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={progress.done}
          aria-valuetext={progress.label}
          className="sr-only"
        />
      ) : null}
      <motion.div
        ref={hop}
        className="splash-orb relative"
        initial={{ opacity: 0, y: -28, scaleX: 0.94, scaleY: 1.08 }}
        animate={{ opacity: 1, y: 0, scaleX: 1, scaleY: 1, transition: spring.bouncy }}
      >
        <span ref={orbRef} className="block">
          <Mawl size={STAGE_ORB} state={waking ? 'sleepy' : mascot} way={way} />
        </span>
      </motion.div>
      {retry && mode === 'retry' ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-1 inline-flex h-6 items-center gap-1 rounded-xs bg-surface-2 px-2 text-micro text-text-2 tabular-nums"
        >
          <RotateCw className="splash-retry-icon size-3" />
          {retry.of ? `${retry.attempt} of ${retry.of}` : `Try ${retry.attempt}`}
        </span>
      ) : null}
    </div>
  )
}

function Arc({ i, state }: { i: number; state: BeadState }) {
  const d = arcPath(i)
  return (
    <g data-arc={i} data-state={state}>
      <path d={d} className="splash-arc-track" />
      {state === 'active' ? <path d={d} pathLength={1} className="splash-arc-active" /> : null}
      <motion.path
        d={d}
        className="splash-arc-done"
        initial={false}
        animate={{ pathLength: state === 'done' ? 1 : 0, opacity: state === 'done' ? 1 : 0 }}
        transition={{
          pathLength: { type: 'spring', stiffness: 120, damping: 22 },
          opacity: { duration: durSeconds.fast },
        }}
      />
    </g>
  )
}

function Bead({ name, i, state }: { name: (typeof STEPS)[number]; i: number; state: BeadState }) {
  const at = onRing(beadAngle(i))
  return (
    <g data-bead={name} data-state={state} transform={`translate(${at.x} ${at.y})`}>
      <motion.g
        className="splash-bead"
        initial={false}
        animate={{ scale: state === 'done' ? 1 : state === 'active' ? 0.92 : 0.8 }}
        transition={spring.bouncy}
      >
        <g className="splash-bead-pulse">
          <circle r={RING.bead} className="splash-bead-body" />
          <g className="splash-bead-glyph" transform="scale(0.3)">
            <GlyphShape kind={BEAD_GLYPH[name]} ink="currentColor" heavy />
          </g>
        </g>
      </motion.g>
    </g>
  )
}

/** True for {@link WAKE_MS} after mount when `enabled`: the eyes open from sleepy brackets. */
function useWake(enabled: boolean): boolean {
  const [waking, setWaking] = useState(enabled)
  useEffect(() => {
    if (!waking) return
    const timer = setTimeout(() => setWaking(false), WAKE_MS)
    return () => clearTimeout(timer)
  }, [waking])
  return waking
}

/** A small hop with a squash each time another step finishes. */
function useHopOnStep(done: number, reduce: boolean) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const last = useRef(done)
  useEffect(() => {
    const grew = done > last.current
    last.current = done
    if (!grew || reduce || !scope.current) return
    void animate(
      scope.current,
      { y: [0, -14, 0], scaleX: [1, 0.96, 1.04, 1], scaleY: [1, 1.05, 0.95, 1] },
      { duration: 0.42, ease: ease.out },
    )
  }, [done, reduce, animate, scope])
  return scope
}
