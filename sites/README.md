# Mawl — Electric paper garden

An independent landing-page redesign for review. The existing `site/` and its deployment are unchanged. No build step, remote fonts, analytics, or runtime CDN dependencies.

Run `node sites/preview.mjs` from the repository root and open http://127.0.0.1:4173. The preview server binds only to loopback. The source folder itself is the static website; `preview.mjs` is a development utility, not a production server.

## Design contract

The visitor should understand Mawl's vision for automating everyday work and creative workflows, try an illustrative teammate handoff, and find the source repository. Its personality combines a capable teammate with a creative companion. The owner's direction is “Electric Tokyo night midnight paper garden,” with clear navigation, room to breathe, and one memorable, living illustration.

- Palette: night ink `#101016`, paper `#f1eddf`, electric violet `#7950e8`, lilac `#bda4ed`, pistachio `#d6ea95`, and pink `#f0aec6`. Values are declared as CSS tokens.
- Type: locally hosted Bricolage Grotesque for expressive display type; Figtree for readable UI and body copy. Existing font license files are retained.
- Composition: spacious split hero and a newly generated moonlit rooftop studio, a lilac interlude, a hands-on workflow preview, a paper-colored memory and efficiency section, development information, and an inviting close. Mobile retains the artwork after the primary copy and actions. Lime Mochi sits on the dark terrace, without green scenery competing with the silhouette.
- Motion: one entrance composition; slow star motion; deliberate mascot greeting; interruptible workflow transitions; an animated poster concept in the canvas example. Hero ambient animation pauses on focus, offscreen, in hidden tabs, and through an explicit control. Reduced motion renders static composition and requires explicit film playback.
- Interaction: three scripted workflow examples, a loading state, a completed teammate handoff, a live illustrated canvas concept, centered restart, mascot greetings, native FAQ disclosures, a keyboard-accessible film dialog, pause/replay/scrub controls, and opt-in synthesized audio. No live AI or invented backend.
- Product truth: the page foregrounds the product vision for automation, creative canvases, teammate messaging, long-term memory, and efficient context. Planned features are identified. Cache-aware prompt foundations are implemented; memory retrieval and collaborative workflows are not promoted as shipped or benchmarked. Online model context is disclosed. No invented testimonials, usage savings, release downloads, or signup collection.

## Assets and dependencies

The replacement night illustration was generated with the built-in image-generation tool, then saved as `assets/night-studio.png`. The page loads `assets/night-studio.webp`, a 1152px version with transparency preserved (about 233 KB). The full generation prompt and mode are recorded in `assets/night-studio.prompt.txt`. Mochi remains the interactive flat SVG symbol; the 3D mascot is not included.

`paper-film.js` adapts the owner's mockup source from `Downloads/mockup/source/paper-film.js`, matching the provided 30-second MP4. It retains the original paper artwork and original synthesized score. Its three GSAP easing functions are expressed locally; the landing's animation library is Motion **14.3.0** (MIT), vendored from the repository's installed package with its license. The film loads only when requested. No 72 MB video download is necessary.

For comparison only, set `MAWL_REFERENCE_DIR` to the owner's local mockup folder before running the preview. This exposes that folder under `/reference/` on loopback. It is not part of the page or required to run it.

## First-pass verification

Reviewed rendered compositions at 1440, 1100, 760, and 390 pixels, with additional overflow checks at 375 pixels and 844 × 390 landscape. Compared scroll width against the document's client width, including the scrollbar. Corrected the narrow-phone orbit overflow. Review screenshots are in `review/`.

Exercised scenario selection, the loading state, successful responses, restart, and switching scenarios during a pending response. Verified mascot feedback, pause/resume, FAQ keyboard activation, modal focus, Escape and focus restoration, timeline scrubbing, replay, and sound toggle behavior. The provided MP4 and the adapted canvas film were inspected. No page-origin runtime errors were observed; unrelated Chrome extension errors are outside the page.

Text contrast ratios: paper/ink 16.18:1; secondary text on the darkest raised surface 6.81:1; ink/lime 14.50:1; ink/lilac 8.75:1. JS syntax checks, scoped Biome checks, and `git diff --check` pass. The reduced-motion code path was reviewed and the equivalent explicit pause path exercised; OS reduced-motion emulation was not available. No full monorepo, Docker, or app-runtime suite was run for this independent static page.

This is a local design iteration awaiting the owner's visual feedback. Publication is outside this pass.

## Second pass — 2026-10-24

Replaced the night garden with a new rooftop-studio illustration and positioned the lime mascot against its dark terrace. Reframed the hero and examples around routine automation, creative design and animation canvases, and teammate communication. Added memory and token-efficiency copy grounded in `docs/MEMORY.md`, `docs/CANVAS.md`, and the current roadmap.

Centered the play glyph, gave the film button a stable 112px width across Play/Pause/Replay, and gave the workflow restart a centered circular replay icon. Scrubbing to the end now selects the replay state. Reviewed the new artwork and canvas example on desktop and mobile, fixed a mobile typography collision, and checked for horizontal overflow at 375/390/760/1100/1440 px. Updated screenshots use `*-v2.jpg` filenames. Scoped Biome, JS syntax, and diff checks pass.

## Motion, navigation, and SEO pass — 2026-10-24

Added Motion scroll-linked studio depth, a rotating interlude motif, a settling workflow preview, and movement in the memory and house illustrations. Text stays present and readable. Pausing cancels scroll bindings and restores the static view; reduced motion skips the effects. The studio has a traveling handoff spark, window-light variation, drifting motes, and a printed SVG mochi with a grounded contact shadow, subtle breathing, and blinking. The character remains two-dimensional and separate from the bitmap so greetings stay interactive.

The desktop scroll rail supports thumb dragging, track clicks, Arrow Up/Down, Page Up/Down, Home, and End. It reports its position and section through an accessible scrollbar role. Native wheel scrolling is preserved. Small screens and coarse pointers retain native scrolling. The mobile header and hero content column have centered bounds with left-aligned type. The house infographic has its own local-first section again.

SEO now includes a descriptive title, description, `https://mawl.tech/` canonical URL, Open Graph and Twitter metadata, factual SoftwareApplication/SoftwareSourceCode JSON-LD, a single-page sitemap, robots rules, and a purpose-built 1200 × 630 social image. `assets/social-card.html` is its noindex render source; `assets/social-card.png` is the shareable image. The hero has a smaller 640px WebP source for phones. No ratings, reviews, download offers, or efficiency benchmarks are fabricated.

`_worker.js` prepares the Cloudflare Pages redirect from `www.mawl.tech` to `https://mawl.tech`, preserving paths and query strings, then delegates to static assets. The host redirect, DNS attachment, and public indexing are not live changes in this local iteration. The existing CI still publishes `site/`; publication of this `sites/` version is a separate step. Both domain variants must be attached in the hosting configuration when publishing.

Verified drag and keyboard scrolling, pause/resume including full-opacity restoration, responsive bounds at 320/375/390/760/761/1100/1440 px, no horizontal overflow, local asset references, structured-data parsing, social-image dimensions, sitemap and canonical consistency, and redirect behavior with a local asset-binding stub. OS reduced-motion emulation remains unavailable; its code path and equivalent pause state were inspected. Scoped syntax, Biome, and diff checks pass. Review screenshots use `*-v3.jpg` filenames.

## Brand and motion refinement — 2026-10-24

The repository's root README now shares the landing page's language, palette, and a dedicated native SVG banner. Setup, owner-token guidance, provider references, development commands, repository layout, and the documentation map remain present. Product directions are separated from current foundations.

The canvas poster is now present in the initial HTML and visible as the default chat example; selecting the canvas tab or restarting no longer hides it behind the follow-up action. Scroll effects have longer travel and larger rotations. The memory and house graphics have gentle, independent motion, suspended when offscreen or when page motion is paused. Mochi breathes every 3.8 seconds and blinks every 4.8 seconds, with no automatic speech bubbles.

The new site icon is a violet night window with a paper moon and pistachio mochi. `assets/favicon.svg` is the vector source, `assets/favicon.ico` contains 16/32/48px fallbacks, and `assets/apple-touch-icon.png` is the 180px touch icon. Versioned favicon links refresh cached browser icons. The desktop app's icon is separate.

Checked default canvas visibility, single-instance rendering, offscreen infographic suspension, global pause behavior, README file links, icon references, and responsive widths at 320/390/761/1100/1440 px. Scoped Biome, syntax, and diff checks pass. No Docker or full workspace suite was run for these documentation and static-site changes.

## Header animation continuity fix

Scroll effects now start paused until attached to their timelines, wait for font layout, and retain their timelines when a workflow example changes height. Layout refreshes are coalesced into a measurement update rather than restarting the hero. The header entrance changes opacity only, avoiding positional resets during font loading. Regression tests first reproduced the free-running and timeline-recreation defects; the three scoped landing test files now pass (11 tests), along with root TypeScript, scoped Biome, syntax, and diff checks. Local screenshot artifacts are excluded from Git.
