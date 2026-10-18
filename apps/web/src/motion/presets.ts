import { durSeconds, ease, spring } from '@faire/ui'
import type { Transition } from 'motion/react'

/**
 * Motion presets built from the @faire/ui tokens (DESIGN.md §7). MotionConfig turns every one of
 * them into an instant change when reduced motion is on, so callers never branch on it.
 */
export const transitions = {
  gentle: spring.gentle,
  snappy: spring.snappy,
  bouncy: spring.bouncy,
  fade: { duration: durSeconds.base, ease: ease.out },
  /** Exit faster than enter: about 70% of the enter duration. */
  exit: { duration: durSeconds.base * 0.7, ease: ease.out },
} satisfies Record<string, Transition>

/** Press: scale 0.97 and spring back. Buttons, cards and list rows. */
export const press = { whileTap: { scale: 0.97 }, transition: transitions.snappy } as const

/** Content arriving: opacity 0 to 1 and y 6 to 0. */
export const enter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: transitions.gentle },
  exit: { opacity: 0, transition: transitions.exit },
} as const

/** The context panel sheet slides in from the right edge. */
export const sheetFromRight = {
  initial: { x: '100%' },
  animate: { x: 0, transition: transitions.gentle },
  exit: { x: '100%', transition: transitions.exit },
} as const

export const overlayFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transitions.fade },
  exit: { opacity: 0, transition: transitions.exit },
} as const
