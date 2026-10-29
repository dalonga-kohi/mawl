/** Motion tokens from docs/DESIGN.md §7. Transitions are plain objects for `motion/react`. */

export const spring = {
  /** Panels, sheets, layout shifts */
  gentle: { type: 'spring', stiffness: 170, damping: 26 },
  /** Toggles, tabs, chips */
  snappy: { type: 'spring', stiffness: 420, damping: 34 },
  /** Celebrations, mascot hops, badge pop-in */
  bouncy: { type: 'spring', stiffness: 260, damping: 14 },
  /**
   * Critically damped (ratio 1.0), about a 0.3 s response: the sidebar slide and the active-row
   * indicator. Settles without overshoot and re-targets from its current velocity when interrupted.
   */
  glide: { type: 'spring', stiffness: 440, damping: 42 },
} as const

/** Milliseconds, for CSS and timers. */
export const dur = { fast: 100, base: 200, slow: 320 } as const

/** Seconds, for Motion's `duration`. */
export const durSeconds = { fast: 0.1, base: 0.2, slow: 0.32 } as const

export const ease = {
  /** Default tween, as a Motion easing array. */
  out: [0.2, 0.8, 0.2, 1],
  outCss: 'cubic-bezier(.2,.8,.2,1)',
} as const

/** Used in place of any spring when the user prefers reduced motion: an instant opacity fade. */
export const reducedMotion = { duration: 0 } as const
