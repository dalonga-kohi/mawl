/** Space, shape and elevation tokens from docs/DESIGN.md §5. */

/** 4 px grid, in px. */
export const spacing = [4, 8, 12, 16, 20, 24, 32, 40, 56] as const

export const radii = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const

/** Dark mode swaps shadows for a 1 px --line border (surface contrast does the work). */
export const shadows = {
  light: {
    shadow1: '0 1px 2px rgb(16 24 40 / .05)',
    shadow2: '0 8px 24px -8px rgb(16 24 40 / .12)',
  },
  dark: {
    shadow1: '0 0 0 1px var(--line)',
    shadow2: '0 0 0 1px var(--line)',
  },
} as const
