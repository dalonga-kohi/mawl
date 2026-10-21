/**
 * Mawl's eight states (docs/UI-REDESIGN.md §4). Six come from the user's mint reference; `listening`
 * and `waiting` are drawn in the same style for DESIGN.md §8.
 */
export const MASCOT_STATES = [
  'idle',
  'listening',
  'thinking',
  'working',
  'waiting',
  'done',
  'oops',
  'sleepy',
] as const
export type MascotState = (typeof MASCOT_STATES)[number]
