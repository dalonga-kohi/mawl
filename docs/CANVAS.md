# Mawl — Canvas

Status: **proposed**, 2026-10-24. Plan only; nothing is built. Once accepted, the decisions in §14 (ADR C1–C14) are binding the way REDESIGN's R1–R14 are, and SPEC, ARCHITECTURE and PLAN point here. Where this file and an older doc disagree about canvases, this file wins.

Owner decisions (2026-10-24): the phase goes **after D5**; the MVP is **mockups and sites**; video export comes **later, through a Docker computer**; teammates get **a dedicated, quality-focused skill set** (not generic prompting); there is **a separate view to browse and manage every generated canvas**.

## 1. What a canvas is

A **canvas** is a small, versioned front-end project that a teammate writes (JSX/TSX, CSS, assets) and Mawl renders live in a sandbox next to the chat. It covers four kinds:

| Kind | What the teammate produces | MVP |
|---|---|---|
| `mockup` | One screen or a few screens of an app or product, at phone, tablet and desktop widths | yes |
| `site` | A multi-file, multi-page front-end site (hash routing), exportable as a project | yes |
| `graphic` | Charts, diagrams, posters, infographics (SVG and HTML) | yes, same runtime |
| `motion` | Animated compositions with a timeline (scrub, play, export) | no, DC9 |

It is not an IDE, not a deploy target and not a backend: no server code, no database, no auth, no publishing in v1. A "real site" means a front-end that runs offline and can be exported as a Vite project.

Why it fits Mawl: it needs no Docker for the MVP, it makes a teammate's work visible and shareable, and it reuses the D2 plumbing (tool registry, policy, artifacts, run inbox, skills).

## 2. Principles

1. **Quality is a system, not a prompt.** A teammate that writes code blind produces slop. Quality comes from three things working together: a design brief written first, measurable checks on the rendered result, and a critique pass with a rubric (§8).
2. **The sandbox is the product's most dangerous surface.** Agent code is untrusted and may be prompt-injected. It never touches the launch token, `/rpc`, the network or the host (§6).
3. **One build path, one output.** The server builds a canvas version into one self-contained HTML file. Preview, thumbnails, export and the later mobile viewer all consume that file (§5).
4. **Always-on stays true.** The agent runs in the server, possibly with the window closed. Nothing in the agent's loop may require a live iframe (§7).
5. **Versioned, never overwritten.** Every write is an immutable version. The user can see, diff and restore anything the agent did.
6. **Offline and deterministic.** Libraries are vendored and pinned. No CDN, no network at render time.

## 3. User experience

### 3.1 In the conversation
- A teammate's tool activity shows a **canvas card** (title, kind, version number, thumbnail when one exists, "Open").
- Opening a canvas shows the **canvas panel** in the workspace area (UI-REDESIGN §5): tabs **Preview · Code · Versions**; a viewport switch (390 / 768 / 1280 / fit); a console drawer that lists the sandbox's errors and the last review results; Copy, Export and "Open in Canvases".
- States, as for every UI slice: loading (building), empty (no version yet), error (build failed, with the diagnostic and its line), success.
- The Code tab is **read-only in v1**; the user asks the teammate to change things. Hand editing is DC12.

### 3.2 The Canvases view (new top-level page)
A separate page, `Canvases`, in the sidebar next to Search · Tools · Scheduled · Approvals. It is where every generated canvas lives, across all teammates.

- **Gallery** of cards: thumbnail, title, kind, teammate, last updated, version count, a star. Thumbnails come from the latest render snapshot; before one exists the card shows a kind placeholder.
- **Filters and search:** teammate, kind, starred, archived, text search over title and notes; sort by updated, created or title.
- **Detail:** the same panel as in chat, full size, with the Versions tab (diff between any two versions, restore), the source thread and run ("made in <thread>"), and the latest review report.
- **Actions:** open, rename, star, duplicate (makes a copy with one version), archive and unarchive, **delete** (user only, confirmed, permanent), export, bulk archive and export, and the **Allow network** switch (§6.4).
- **Teammate page:** a Canvases tab with the same list scoped to that teammate.
- Works at 390 px (single column, bottom sheet for detail); respects reduced motion; keyboard reachable.

### 3.3 Export
- **HTML:** the single self-contained file.
- **PNG:** a snapshot at a chosen viewport.
- **Project zip:** `package.json` with the vendored libraries pinned to the same versions, Vite config, `src/`, assets. `npm i && npm run dev` works.
- **Video (MP4/GIF/WebM):** motion canvases only, rendered on a computer (§9, DC10).
- Export writes where the user picks, through the host's save dialog. The agent cannot write outside Mawl's own storage.

## 4. Data model

Added to ARCHITECTURE §9 (a migration in DC1):

```
canvases(id, profile_id, thread_id|null, run_id|null, title, kind{mockup|site|graphic|motion},
         current_version_id, starred, thumbnail_artifact_id|null, network_allowed bool default false,
         created_at, updated_at, archived_at)
canvas_versions(id, canvas_id, no int, parent_version_id|null,
                files jsonb,            -- { "<path>": "<utf-8 text>" }, total <= 512 KiB
                assets jsonb,           -- { "<name>": "<artifact id>" }
                entry text, packs jsonb, -- the vendored libraries and their versions
                build_hash text, size_bytes int,
                author{agent|user}, run_id|null, step_idx|null, note text,
                diagnostics_json, render_report_json|null, created_at)
```

- `canvas_versions` rows are immutable. `current_version_id` moves; restore creates a new version that copies an old one.
- Retention: keep the latest 100 versions per canvas plus any starred or restored one; older ones are pruned by the sleep-time maintenance job (D4.6), never during a run.
- Assets are `artifacts` (images, fonts the user supplies); a canvas references them by name and the build inlines them. Caps: 25 MiB of assets per canvas, 5 MiB per asset.
- Ids: prefixed ULIDs `cnv_…` and `cnv_ver_…` through `newId` in `@mawl/contracts`.
- Contracts are `z.strictObject`. **No file contents in events**, only ids and counts.

## 5. Build pipeline (`packages/canvas`)

A JIT internal package (`@mawl/canvas`), pure and testable: `buildCanvas(files, assets, packs, options) → { html, diagnostics, buildHash }`.

1. **Validate:** path rules (no `..`, no absolute paths, size and file-count caps), an **import allowlist** (only relative imports and the pack names the canvas declares), forbidden APIs flagged (`eval`, `new Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `import()` of a URL, `window.parent`/`top`).
2. **Transform and bundle:** JSX/TSX to JS, with source maps so a diagnostic points at the agent's own line and column.
3. **Inline:** packs, the CSS, curated font subsets and assets as data URIs, into one HTML document with the CSP of §6.
4. **Hash:** `buildHash` over the inputs. Same inputs give the same output, so the build is cacheable and testable.

**The server builds, the client only hosts the iframe** (C3). It gives one tested build path, lets the agent get diagnostics with no UI attached, and gives export, thumbnails and the mobile viewer the same HTML. The client fetches the built document for a version over RPC (cached by `buildHash`).

**Open choice (DC0.1 decides, with measurements):** the transformer or bundler.

| Candidate | For | Against |
|---|---|---|
| `esbuild` (native, already the repo's bundler) | Real bundling, tree-shaking, source maps, fast | A native binary in the installer (about 10 MB): the budget is 60 MiB and the installer is 46 MiB today |
| `esbuild-wasm` | No native binary | Larger (about 12 MB) and slower start |
| `sucrase` or `oxc-transform` + an import map | Tiny, no bundler | Weaker source maps and tree-shaking; sucrase is barely maintained |
| Download the engine on first use | Keeps the installer small; precedent exists (the Claude binary, REDESIGN §10.2) | A first-use download, a hash pin, and an offline gap |

Pass criteria: works inside the esbuild-bundled `server.mjs` on Node 24, license acceptable, maintained, cold build under 400 ms for a 20-file canvas, installer stays under 60 MiB (or the download option is taken).

### 5.1 Packs (vendored, pinned, offline)
A **pack** is a pinned library the build can inline. A canvas declares the packs it uses; only those are inlined.

| Pack | Purpose | Notes |
|---|---|---|
| `react` + `react-dom` | The UI runtime | Always |
| `motion` | UI animation | Verify license and the seek API |
| `gsap` | Timelines, motion graphics | **Verify the license terms before pinning** (the current "no charge" license has a competing-product restriction) |
| `three` + `@react-three/fiber` | 3D and WebGL | Lazy; large |
| `d3` (modules) | Data graphics | |
| `lucide` icons | Icon set (ISC) | The agent must use icons, not emoji |
| Fonts | About 12 curated OFL families, subset to woff2 | Inlined only when used; listed in third-party notices |
| Tailwind | **Not in v1.** Runtime Tailwind needs a compiler; the design brief's CSS variables plus plain CSS cover the need | Revisit if the quality eval shows it matters |

Pin exact versions, check each license and maintenance state in DC0.1, and add a test that the allowlist, the pack table and the export `package.json` agree. Remotion is **rejected** (C9): its license is not OSI-approved and Mawl's repo is public; the motion contract in §9 is ours, on top of seekable open libraries.

## 6. Sandbox and security

### 6.1 Isolation
- The preview is an `<iframe sandbox="allow-scripts">` with **no `allow-same-origin`**, so the document has an opaque origin: it cannot read `window.__MAWL_LAUNCH_TOKEN__`, `sessionStorage`, cookies, or call `/rpc` or `/ws`.
- No `allow-forms`, `allow-popups`, `allow-modals`, `allow-top-navigation`, `allow-downloads`.
- The document is delivered by `srcdoc` (or a blob), never from the app's own origin.

### 6.2 Content-Security-Policy (set in the document)
`default-src 'none'; script-src` limited to the build's own inline scripts (hash or nonce, decided in DC0.1; `'unsafe-eval'` only if a pack provably needs it); `style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`.

Opaque origins throw on `localStorage`, so the runtime shims in-memory storage. WebGL, canvas and Web Animations work.

### 6.3 The host channel
Only `postMessage`, schema `canvas-host/1`, validated with zod on both ends:
- iframe → host: `ready`, `console`, `error`, `size`, `review-result`, `time`.
- host → iframe: `review {widths}`, `seek`, `play`, `pause`.
- The host accepts a message only when `event.source === iframe.contentWindow` **and** `event.origin === 'null'`; payloads are size-capped (64 KiB) and rate-limited. Console text, error text and review output are **untrusted data**: they are wrapped in `<untrusted>` when they reach the model and are never rendered as HTML in the app.

### 6.4 Network
Offline by default, always. A per-canvas **Allow network** switch exists for the user only (the Canvases view and the panel menu); it relaxes `connect-src` and `img-src` for that canvas and is recorded in the audit log. **No agent tool can change it**, and a canvas created or edited by an agent never gets it silently. Fonts and images the agent needs arrive as pack fonts or as assets (a fetched image is stored as an artifact through `web_fetch`'s own policy, then attached with `canvas_add_asset`).

### 6.5 Policy and prompt injection
- Canvas tools are `write_local`, `auto`, and scoped to the calling teammate's own canvases.
- The agent has **no** delete, no network switch, no export-to-disk and no publish tool in v1. Any later deploy or share link is `external_post` (ask).
- `canvas_read` output is wrapped as data. A canvas built from scraped web content may carry injected instructions; the agent's own earlier output is not trusted merely because the agent wrote it.
- Build limits: file count, file size, total size, and build time (the build runs in a worker with a timeout), so a hostile or runaway input cannot stall the server.
- A security-focused review (head-reviewer) is proposed for DC2 and DC4: build validation and the sandbox boundary.

## 7. Agent tools

| Tool | Does | Returns |
|---|---|---|
| `canvas_create(title, kind, template?)` | New canvas from a template (blank page, multi-page site, motion composition) | `canvasId`, version 1 |
| `canvas_write(canvasId, files[], note?)` | Writes one or more whole files as one new version | version number and diagnostics, **not** the contents |
| `canvas_edit(canvasId, path, oldString, newString, replaceAll?)` | Exact string replacement, one new version | version number and diagnostics |
| `canvas_read(canvasId, path?, range?)` | Reads a file or a line range | the text, wrapped as data |
| `canvas_list()`, `canvas_history(canvasId)` | The teammate's canvases and their versions | ids, titles, notes |
| `canvas_restore(canvasId, versionNo)` | New version copying an old one | version number |
| `canvas_add_asset(canvasId, name, artifactId)` | Attaches an artifact as a named asset | ok or a typed error |
| `canvas_review(canvasId, widths?)` | Renders and checks the current version (§7.1, §8.2) | a lint report; screenshots when the model can see images |

Rules that keep tokens and context sane: results never echo file contents, `canvas_edit` is preferred over rewriting a file, large files are read by range, and a failed build returns the diagnostic with the offending line and a small excerpt. Tools carry idempotency keys (`run_id`, `step_idx`, `toolCallId`) like every D2.2 tool, so a resumed run does not create a second version.

### 7.1 Seeing the result (render feedback)
A teammate that cannot see what it made produces slop, so render feedback is part of the MVP, in three tiers:

1. **Server-side check, always:** the build's diagnostics and the static lint (imports, forbidden APIs, caps, missing assets, token usage, placeholder text).
2. **Client render, when a client is attached:** the panel renders the version, runs the review script inside the sandbox, and reports back through `canvases.reportRender`. If the run is waiting on it, the result goes to the **run inbox** (D2.5) as a typed follow-up.
3. **Computer render, when the teammate has a computer (D3) and no client is attached:** the server copies the built HTML to the computer and runs the same review script in its headless Chromium (Playwright), so the window can stay closed. This is the reason the review script is plain JS with no host dependencies.

If none is available, `canvas_review` says so plainly ("static checks only, not rendered") and the skill tells the teammate not to claim a visual result.

## 8. Quality system

This is the most important section. Slop in generated UI is predictable, so the plan attacks it at four points.

### 8.1 Dedicated skills (built in, versioned, owner-approved text)
Shipped as Agent Skills (`SKILL.md`, D2.8) with source `builtin`, loaded on demand (progressive disclosure). Mawl writes its own text; third-party design skills used for building Mawl itself are inspiration only and are not copied.

| Skill | Teaches |
|---|---|
| `canvas-core` | The workflow: brief → direction → tokens → build → review → fix → deliver; the tool contract; stop conditions; how to read a review report; honesty rules ("never say it looks good without a render") |
| `canvas-design-direction` | Turning a request into a **design brief file** (`DESIGN.md` inside the canvas): audience, tone, one named visual direction chosen from a menu with reasons, a palette in OKLCH (one accent, neutrals), a type pair, a spacing scale, radius and shadow rules, motion rules. The code may use only these tokens |
| `canvas-mockup` | App and product screens: real information architecture, all states (empty, loading, error, hover, focus), realistic content, device widths, density |
| `canvas-site` | Multi-page sites: structure, navigation, hero with a point of view, content hierarchy, responsive behavior, accessibility, export-ready file layout |
| `canvas-dataviz` | Charts and diagrams: choosing the form, honest scales, labeling, accessible color, no chart junk |
| `canvas-motion` | Timelines, easing, choreography, the seek contract (arrives with DC9) |
| `canvas-critique` | The rubric for the review loop: what to look for in screenshots, how to rank issues, when to stop |
| `canvas-copy` | Specific, human copy instead of placeholders |

The skills carry **direct, imperative instructions and a named list of slop tells to avoid**, for example: default purple-to-blue gradients; the centered hero over three equal feature cards; emoji used as icons; lorem ipsum and "John Doe"; invented metrics; five font families; mixed corner radii; low-contrast grey text; shadows doing the work hierarchy should do; "Welcome to…" headlines. Each "avoid" comes with the positive move to make instead.

A conditional `canvas` prompt block (like the `computer` block) is added to the system prompt only when canvas tools are enabled, and points at `canvas-core`. A prompt layout change updates MEMORY.md §7 and the snapshot tests, per the server rule.

### 8.2 Measurable gates (`canvas_review`)
The review script returns pass/warn/fail rows. The skill rule is: **do not deliver with a fail**.

- Contrast of text against its real background (WCAG, using `culori` as `@mawl/ui` already does); minimum text size; tap target size (44 px) on the 390 px viewport.
- Horizontal overflow at 390, 768 and 1280 px; elements clipped outside the viewport.
- Distinct font families (max 2 by default), distinct hues beyond the brief's palette, colors or sizes used outside the design tokens.
- Placeholder text (lorem, "John Doe", `example.com`, "Your text here"), emoji used as icons.
- Missing `alt` or labels, missing focus styles, heading order.
- Console errors, a blank or near-blank render, missing assets, layout shift on load.
- `prefers-reduced-motion` handled when the canvas animates.

### 8.3 A critique pass
After the gates pass, the teammate looks at screenshots at 390 and 1280 px (the main model if it sees images, else the helper model, else it skips the pass and says so) against the `canvas-critique` rubric, fixes the top issues, and re-reviews. The number of passes is capped (default 2) to bound cost.

### 8.4 Memory and consistency
The teammate recalls the owner's stated design preferences (D4) before the brief, and a good brief is reused across a teammate's canvases. A per-teammate **brand kit** (shared tokens and fonts) is a later slice (DC13).

### 8.5 Evaluation
DC11 adds an eval set: about 12 fixed briefs across the kinds. In CI the fake model checks the plumbing (tools, diagnostics, the review loop, caps). By hand, with a real model, each output is scored on the review gates plus a short human rubric, and skill text versions are compared so a prompt edit cannot silently make things worse.

## 9. Motion canvases (DC9, DC10)

A composition declares `{ width, height, fps, durationInFrames }` and renders as a function of time. The host owns the clock:

- During **preview**, the host drives playback and scrubbing.
- Everything must be **seekable**: registered GSAP timelines, Motion animations, and the page's Web Animations (`document.getAnimations()` with `currentTime`). Custom loops use the host's `useTime()` instead of `Date.now`, `performance.now` and `requestAnimationFrame`, which the runtime virtualizes during export.
- The `canvas-motion` skill forbids unseekable patterns (free-running CSS animation in a motion canvas, timers).

**Video export (DC10, depends on D3).** The server copies the built HTML to a computer, steps the host clock frame by frame, captures each frame with Playwright, and encodes with `ffmpeg` into MP4, GIF or WebM, with progress as a job and the result stored as an artifact. This needs `ffmpeg` in the terminal image: the 500 MB target in ARCHITECTURE §6 is revisited in DC10 (either a larger terminal image or a separate render image). DOM-heavy and WebGL scenes both work because the capture is a real browser.

**Spikes (DC0.3):** verify that seeking WAAPI and GSAP gives frame-exact output, how `performance.now` and `requestAnimationFrame` are virtualized safely, capture speed per frame, and the license and size of the chosen libraries. A realtime WebM capture of a canvas element was considered as a Docker-free path and **rejected** for v1 (not frame-exact, poor for DOM scenes).

## 10. Integration with the rest of Mawl

| Area | Integration |
|---|---|
| Run engine (D2) | Canvas tools use the registry, the policy engine and idempotency keys; render feedback arrives through `run_inbox` follow-ups; events are stored, secret-free, content-free |
| Skills (D2.8) | The built-in skill set needs a `builtin` source value and a rule that builtin skills are read-only for the teammate and updated with the app |
| Computers (D3) | Headless render and video export run on a computer; imports of files from a computer arrive as artifacts |
| Memory (D4) | Episodes reference canvas ids; design preferences are recalled; canvas content is not memory |
| Schedules (D5) | A routine may create or update a canvas (a weekly report page); its delivery can attach the snapshot |
| Channels (D7) | Delivery of PNG snapshots and links back to the app |
| Mobile (D8) | A read-only viewer shows the built HTML in a WebView |
| Desktop packaging (D1) | Packs and fonts ship in the server bundle or web build; the installer budget stays under 60 MiB (§5) |

## 11. Events and contracts

New event types (all `z.strictObject`, no contents), added without bumping the envelope version because clients skip unknown types:
`canvas.created`, `canvas.version`, `canvas.updated` (rename, star, archive, network switch), `canvas.deleted`, `canvas.render_report`.

RPC: `canvases.list/get/rename/star/archive/unarchive/delete/duplicate`, `canvases.versions`, `canvases.restore`, `canvases.build` (the built HTML for a version), `canvases.reportRender`, `canvases.setNetwork`, `canvases.export`.

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sandbox escape or token exposure | Low if the design holds | Severe | Opaque origin, CSP, `postMessage` schema, no agent control of network, head-review of DC2 and DC4, a test that the iframe cannot read the token or reach `/rpc` |
| Output still looks generic | High | The feature's whole value | §8: brief file, gates, critique, eval; accept that a weak model produces weaker work and show the model used |
| Installer size grows past 60 MiB | Medium | Breaks the install-and-go promise | DC0.1 measures; the download-on-first-use option exists |
| Library license problems (GSAP terms, Remotion) | Medium | Blocks distribution | Verify in DC0.1; Remotion rejected; pin only what passes |
| Token cost of big file writes | High | Money and latency | `canvas_edit`, no content echo, range reads, cap on file sizes |
| Blind generation when no client or computer is attached | Medium | Lower quality | §7.1 tiers; the skill forbids visual claims without a render |
| Motion export is slow or not frame-exact | Medium | DC10 slips | DC0.3 spike first; DC10 sits behind the MVP cut line |
| Scope creep (a whole IDE) | High | Everything slips | The cut line in PLAN; read-only code view in v1; no backend, no deploy |
| Contracts and migrations collide with other slices | Medium | Merge pain | The phase starts after D5 so it is serial; one writer at a time per file set |

## 13. Out of scope (v1)

Backend or server code in canvases · databases and auth · deploy and publish (any later one is `external_post`, ask) · Tailwind runtime · hand-editing code in the UI (DC12) · real-time collaboration · importing a Figma file · arbitrary npm packages · network access by default.

## 14. Decisions (ADR)

| # | Decision | Alternatives considered |
|---|---|---|
| C1 | A canvas is a versioned file set rendered in a sandbox; every write is an immutable version | One mutable blob; editing files in place |
| C2 | The preview runs in a sandboxed opaque-origin iframe with a strict CSP and no network by default; network is a user-only per-canvas switch | Same-origin iframe; a CDN allowlist; an agent-settable switch |
| C3 | The server builds the canvas into one self-contained HTML; the client only hosts the iframe | Building in the browser (two build paths, no diagnostics when the window is closed) |
| C4 | Vendored, pinned packs; no CDN | CDN imports; Sandpack or WebContainers (need network or a proprietary license) |
| C5 | Render feedback in three tiers (static, client, computer) so the agent can see its work and always-on still works | Requiring an open window; static checks only |
| C6 | Quality is enforced by a dedicated built-in skill set, a design brief file, measurable review gates and a capped critique pass | A single big prompt; trusting the model's taste |
| C7 | Built-in skills are read-only, versioned with the app and owner-approved | Teammate-editable built-ins |
| C8 | No agent tool for delete, network, export-to-disk or publish in v1 | Giving the agent full control |
| C9 | Our own timeline contract on seekable open libraries; Remotion rejected on license | Adopting Remotion |
| C10 | Video export through a computer (Playwright + ffmpeg), after D3 | Realtime canvas capture (not frame-exact) |
| C11 | A separate Canvases view manages every canvas across teammates | Canvases only inside chat threads |
| C12 | MVP = mockups, sites and graphics (DC1–DC8); motion and export follow | All kinds at once |
| C13 | Front-end only: no backend, no deploy in v1 | A full app builder |
| C14 | The phase starts after D5, serial with other work; spikes may run earlier because they change no shared code | Parallel code slices alongside D2 or D3 |
