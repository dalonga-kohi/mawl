import { motion } from 'motion/react'
import { transitions } from '../motion/presets.ts'

/**
 * The sidebar's one active indicator: a --selected fill that slides between the current nav row,
 * the open teammate and the settings button through a shared `layoutId`, on the critically damped
 * glide spring. The host is `relative isolate`, so the fill sits under its content but above its
 * hover wash. Reduced motion (MotionConfig) turns the slide into an instant move.
 */
export function ActiveIndicator() {
  return (
    <motion.span
      aria-hidden="true"
      data-active-indicator=""
      layoutId="sidebar-active"
      transition={transitions.glide}
      className="absolute inset-0 -z-10 rounded-md bg-selected"
    />
  )
}
