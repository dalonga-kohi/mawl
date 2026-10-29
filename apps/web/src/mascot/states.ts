/**
 * Mawl's eight states (DESIGN.md §8). The orb shows each one in its glyph eyes (see POSES in
 * glyphs.tsx); `listening` reuses the idle bars, shorter and glancing down.
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
