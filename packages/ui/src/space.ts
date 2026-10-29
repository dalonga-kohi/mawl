/** Space, shape and elevation tokens from docs/DESIGN.md §5 and docs/UI-REDESIGN.md §2. */

/** 4 px grid, in px. */
export const spacing = [4, 8, 12, 16, 20, 24, 32, 40, 56] as const

/**
 * Soft rounded rectangles, not pills (DESIGN.md §5). The radius grows with the surface; things that
 * are truly round (orbs, avatars, status dots, switch thumbs) use Tailwind's `rounded-full`.
 * - xs 6: inline code, kbd, skeleton lines
 * - sm 8: tooltips, badges, chips, menu items, small icon buttons
 * - md 10: buttons, nav and list rows, tabs and segments, palette rows
 * - card 12: cards, inputs, tiles, menus and popovers, notices, message bubbles
 * - panel 14: the composer, the command palette, sheets and other large surfaces
 * - dialog 16: dialogs, the window and the mobile sheet
 */
export const radii = { xs: 6, sm: 8, md: 10, card: 12, panel: 14, dialog: 16 } as const

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
