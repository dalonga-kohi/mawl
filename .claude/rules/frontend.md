---
paths:
  - "apps/web/**"
  - "apps/desktop/**"
  - "apps/mobile/**"
  - "packages/ui/**"
  - "packages/ui-native/**"
  - "packages/mascot/**"
  - "design/**"
---

# Frontend rules

- Load the `frontend-design`, `ui-taste` and `ui-ux-pro-max` skills (and `ios-design` for mobile) before designing or changing UI. `docs/DESIGN.md` is the source of truth.
- **Expo work** (anything in `apps/mobile/**`, `packages/ui-native/**`, or any Expo/React Native config, build or dependency task) must load the Expo skills from https://github.com/expo/skills (installed under `.claude/skills/`) **in addition to** `frontend-design`, `ui-taste`, `ui-ux-pro-max` and `ios-design`. Expo skills decide how (Expo Router, EAS, SDK-compatible packages, native modules); the design skills decide what it looks like. Never skip either set.
- Use tokens only: colors, radii, spacing, type and motion come from `packages/ui` (CSS vars / TS). The accent is user-changeable, so never hardcode it.
- Build components on Radix primitives (web), using local shadcn-style components. Use Lucide for icons, Motion for web animation, Reanimated/moti for mobile animation, and Rive for the mascot. Don't hand-roll what these provide.
- Copy is sentence case with active verbs. Use user words ("Connections", "Teammates"), not system words ("MCP servers", "profiles") in primary UI.
- Avoid: all-caps eyebrows, identical card grids, decorative gradients, emoji icons, `→` appended to buttons, entrance animations on every section.
- States: loading (skeleton), empty (mascot + next action), error (what happened + how to fix it), success. Every interactive element needs a hover, press, focus-visible and disabled state.
- Accessibility: contrast ≥ 4.5:1 (check every accent preset), keyboard reachable, `aria-label` on icon buttons, 44 px touch targets on mobile, reduced motion respected.
- Responsive: verify at 1440, 1100, 760 and 390 widths in light and dark.
- Data comes from `packages/client` (TanStack Query + WS events). No ad-hoc fetch in components.
- Component tests use Vitest + Testing Library. Flows are covered by Playwright e2e with the fake provider from `packages/testkit`.
