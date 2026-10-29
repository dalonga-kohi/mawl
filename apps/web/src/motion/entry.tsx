import { spring } from '@mawl/ui'
import { useAnimate, useReducedMotionConfig } from 'motion/react'
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Mawl } from '../mascot/Mawl.tsx'
import type { MascotState } from '../mascot/states.ts'
import type { OrbWay } from '../mascot/ways.ts'

/**
 * The orb's hand-off into the app (U14). The splash (another page) and the token gate end on the
 * orb alone on the background; the app's first frame is that same picture, drawn here as a curtain
 * over the app. When the chat landing mounts its big orb, it claims the hand-off: the curtain's orb
 * flies into the landing orb's place and size while the curtain fades, then the landing orb shows
 * and the curtain is gone. Without a claim (the app opened on another page) the orb fades in place.
 * Reduced motion: no flight, a short fade.
 */

/** Where the hand-off starts: the window's centre below the title bar, or a measured orb. */
export type EntryFrom = 'centre' | { x: number; y: number; size: number }

/** How long the curtain waits for the landing to claim the orb before it fades in place. */
export const CLAIM_WAIT_MS = 1200
/** The same wait on a page that has no landing orb to claim (Approvals, Tools, Settings). */
export const NO_CLAIM_WAIT_MS = 200

const NO_LANDING = /^\/(approvals|tools|settings)(\/|$)/

/** How long to hold the curtain for a claim, given the page the app opened on. */
export function claimWaitFor(pathname: string): number {
  return NO_LANDING.test(pathname) ? NO_CLAIM_WAIT_MS : CLAIM_WAIT_MS
}
/** The splash's orb size (`STAGE_ORB` in splash/Stage.tsx), for a hand-off from the centre. */
const CENTRE_ORB = 128

export interface Flight {
  x: number
  y: number
  scale: number
}

/** The transform that moves an orb drawn in `from` onto `to` (both viewport rects). */
export function flightTo(
  from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): Flight {
  const centre = (r: typeof from) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  const a = centre(from)
  const b = centre(to)
  return {
    x: Math.round(b.x - a.x),
    y: Math.round(b.y - a.y),
    scale: from.width > 0 ? to.width / from.width : 1,
  }
}

interface Claim {
  el: HTMLElement
  way: OrbWay
  mascot: MascotState
}

interface EntryContextValue {
  /** True while a hand-off is in progress: a claiming orb stays hidden until it lands. */
  pending: boolean
  claim: (claim: Claim) => () => void
}

const EntryContext = createContext<EntryContextValue>({ pending: false, claim: () => () => {} })

type Phase = 'cover' | 'fly' | 'fade' | 'gone'

export function EntryHandoff({
  from,
  backdrop: backdropArt,
  children,
}: {
  /** `undefined`: there is nothing to hand off, the app shows at once. */
  from: EntryFrom | undefined
  /** Art from the screen being left (the gate's field), drawn on the curtain so it fades with it. */
  backdrop?: ReactNode
  children: ReactNode
}) {
  const reduce = useReducedMotionConfig() ?? false
  const [claimWait] = useState(() => claimWaitFor(window.location.pathname))
  const [phase, setPhase] = useState<Phase>(from ? 'cover' : 'gone')
  const [claimed, setClaimed] = useState<Claim | undefined>()
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const orb = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)

  const claim = useCallback((c: Claim) => {
    setClaimed((current) => current ?? c)
    return () => setClaimed((current) => (current?.el === c.el ? undefined : current))
  }, [])

  // No claim in time: fade in place. Reduced motion never flies.
  useEffect(() => {
    if (phase !== 'cover') return
    if (reduce) {
      setPhase('fade')
      return
    }
    const timer = setTimeout(() => setPhase('fade'), claimWait)
    return () => clearTimeout(timer)
  }, [phase, reduce, claimWait])

  useLayoutEffect(() => {
    if (phase !== 'cover' || !claimed || reduce) return
    setPhase('fly')
  }, [phase, claimed, reduce])

  useEffect(() => {
    if (phase !== 'fly' || !claimed || !orb.current || !backdrop.current) return
    let alive = true
    const flight = flightTo(orb.current.getBoundingClientRect(), claimed.el.getBoundingClientRect())
    Promise.all([
      animate(orb.current, { ...flight }, spring.glide),
      animate(backdrop.current, { opacity: 0 }, { duration: 0.32 }),
    ]).then(
      () => alive && setPhase('gone'),
      () => alive && setPhase('gone'),
    )
    return () => {
      alive = false
    }
  }, [phase, claimed, animate])

  useEffect(() => {
    if (phase !== 'fade' || !scope.current) return
    let alive = true
    animate(scope.current, { opacity: 0 }, { duration: reduce ? 0.12 : 0.24 }).then(
      () => alive && setPhase('gone'),
      () => alive && setPhase('gone'),
    )
    return () => {
      alive = false
    }
  }, [phase, animate, scope, reduce])

  const flying = phase === 'fly'
  const start: CSSProperties =
    from === 'centre' || from === undefined
      ? {
          left: '50%',
          top: 'calc(var(--titlebar-h) + (100dvh - var(--titlebar-h)) / 2)',
          width: CENTRE_ORB,
          height: CENTRE_ORB,
        }
      : { left: from.x, top: from.y, width: from.size, height: from.size }

  return (
    <EntryContext.Provider value={{ pending: phase !== 'gone', claim }}>
      {children}
      {phase === 'gone' ? null : (
        <div
          ref={scope}
          data-entry-curtain=""
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-(--titlebar-h) bottom-0 z-50"
        >
          <div ref={backdrop} className="absolute inset-x-0 top-0 bottom-0 overflow-hidden bg-bg">
            {backdropArt}
          </div>
          <div ref={orb} className="fixed -translate-x-1/2 -translate-y-1/2" style={start}>
            <Mawl
              size={typeof start.width === 'number' ? start.width : CENTRE_ORB}
              // The splash ends happy; in flight the orb settles into whoever it lands as.
              state={flying ? (claimed?.mascot ?? 'idle') : 'done'}
              way={flying ? (claimed?.way ?? 'orange') : 'orange'}
            />
          </div>
        </div>
      )}
    </EntryContext.Provider>
  )
}

/**
 * For the orb that receives the hand-off: a ref to put on its box, and whether to keep it hidden
 * until the flying orb lands on it.
 */
export function useEntryTarget(way: OrbWay, mascot: MascotState) {
  const { pending, claim } = useContext(EntryContext)
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!el || !pending) return
    return claim({ el, way, mascot })
  }, [el, pending, claim, way, mascot])
  return { ref: setEl, hidden: pending }
}
