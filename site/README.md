# Mawl landing page

One static hero, served directly from `site/` by the existing Cloudflare Pages workflow. No build step or runtime dependencies.

Preview: `node site/preview.mjs`, then open http://127.0.0.1:4173.

The palette follows `packages/ui/src/palette.ts`; the lavender orb and peach wave colour come from `apps/web/src/mascot/ways.ts`. `assets/mawl-orb.svg` is copied from `design/assets/mascot-orb/mawl-flat.svg`. Fonts are local with their original licenses.

`script.js` progressively enhances a static CSS atmosphere with a WebGL wave. Its clock is capped at 30 fps, suspends in hidden tabs, preserves manual pause, and renders one still frame for reduced motion. Missing WebGL or context loss leaves the CSS fallback. High contrast and reduced transparency use a plain background. Text and navigation work without JavaScript.

The page includes canonical, social, and structured metadata, robots.txt, sitemap.xml, and llms.txt. Keep these in sync with public product capabilities; llms.txt is descriptive context, not a promise of crawler support or search ranking. The social card is a static 1200 × 630 asset.

Scoped checks: `pnpm exec vitest run --project workspace scripts/landing-site.test.ts scripts/landing-motion.test.ts`, `pnpm exec biome check site scripts/landing-site.test.ts scripts/landing-motion.test.ts`, and `pnpm exec tsc --noEmit -p .`.
