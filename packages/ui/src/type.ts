/** Typography tokens from docs/DESIGN.md §4. Font files are loaded by the apps, not here. */

export const fontFamilies = {
  ui: "'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif",
  /** Onboarding headlines, empty-state lines and the wordmark only. */
  display: "'Bricolage Grotesque', 'Figtree', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace",
} as const

/** size in rem (16 px base), unitless line-height, numeric font-weight. */
export const typeScale = {
  display: { size: 2.25, lineHeight: 1.1, weight: 650 },
  title: { size: 1.375, lineHeight: 1.25, weight: 620 },
  heading: { size: 1.0625, lineHeight: 1.35, weight: 600 },
  body: { size: 0.9375, lineHeight: 1.55, weight: 450 },
  small: { size: 0.8125, lineHeight: 1.45, weight: 500 },
  micro: { size: 0.75, lineHeight: 1.35, weight: 550 },
} as const
