/** Space, shape and elevation tokens from docs/DESIGN.md §5 and docs/UI-REDESIGN.md §2. */

/** 4 px grid, in px. */
export const spacing = [4, 8, 12, 16, 20, 24, 32, 40, 56] as const

/**
 * Everything is round. Interactive controls (buttons, inputs, tabs, chips, toggles) are pills; the
 * small radii are for things inside a surface (inline code, skeleton lines, menu rows, tooltips).
 * - xs 8: inline code, kbd, skeleton lines
 * - sm 12: menu rows, tooltips, code blocks inside a card
 * - md 18: message bubbles, notices, small tiles
 * - card 24, panel 28, dialog 32 (dialogs, the window and the mobile sheet)
 */
export const radii = { xs: 8, sm: 12, md: 18, card: 24, panel: 28, dialog: 32, pill: 999 } as const

/** Dark mode swaps shadows for a 1 px --line hairline (surface contrast does the work). */
export const shadows = {
  light: {
    shadow1: '0 1px 2px rgb(29 27 22 / .05)',
    shadow2: '0 12px 32px -12px rgb(29 27 22 / .16)',
  },
  dark: {
    shadow1: '0 0 0 1px var(--line)',
    shadow2: '0 0 0 1px var(--line)',
  },
} as const
