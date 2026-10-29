# Mawl — Design System

> Calm, lowkey, gentle and a little playful. The UI stays quiet so the work and the mascot can speak.

> **2026-10-21 redesign: [UI-REDESIGN.md](UI-REDESIGN.md) wins over this file** on shape (everything round), shell layout and the shadcn component base. The 2026-10-29 orb pass (PLAN U8 to U14) then replaced its lime mochi and Cream/Ink palette: **this file now wins on palette (§3) and the mascot (§8)**, which describe the Mawl palette and the orb.

The reference mood is the airy blue/white Telegram concepts plus a quiet dark mode. They show direction only; we don't copy them. When you do frontend work, apply the **frontend-design** and **ui-ux-pro-max** skills on top of this document. This document wins on any conflict.

## 1. Concept: "Mawl keeps watch"

Mawl, a soft lavender orb with glyph eyes, keeps watch while your teammates work, and you check in whenever you like. That gives us:
- **Calm surfaces** (the Mawl neutrals, §3: cool paper in light, deep navy in dark): the backdrop.
- **The orb** (Mawl's fixed colourways, §8, lavender by default) and the **Mawl violet** primary, with teal for live status: warmth and character.
- **One memorable element:** the mascot, plus a soft river *wave* line that appears at moments of transition (onboarding, the empty states, the bottom of the mobile login). Everything else stays disciplined.

## 2. Principles

1. **Quiet by default.** One accent, lots of air, few borders. Use structure only when it carries information.
2. **Show the work, not stats.** Activity reads like sentences ("Archived 26 newsletters"), not dashboards.
3. **Gentle motion that answers people.** Everything you touch responds softly. Ambient motion belongs only to the mascot.
4. **Always know what the agent is doing.** State is visible at a glance: mascot, status dot, live computer thumbnail.
5. **Progressive disclosure.** Tool details, memory sources and raw logs are one tap away and never in your face.
6. **Plain words.** Sentence case, active verbs, no jargon ("Connections", not "MCP servers", in user copy; "MCP" appears in the advanced detail only).

## 3. Color

All colors are CSS variables in `packages/ui/src/tokens.css`, generated from `packages/ui/src/*.ts` by `pnpm --filter @mawl/ui generate`. Components never use raw hex.

The default palette is **Mawl** (2026-10 orb redesign, PLAN U8): cool paper in light, deep navy in dark, a violet primary and a teal secondary. U9 adds named palettes beside it.

### Neutrals: light
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#F5F7FC` | The app background: conversation, pages |
| `--surface` | `#FFFFFF` | Cards: composer, popovers, dialogs, tool cards, code blocks |
| `--surface-2` | `#EBEFF7` | The sidebar tone; also hover fills, tab tracks, chips, wells |
| `--line` | `#DCE2EE` | Hairlines (use sparingly) |
| `--text` | `#1B2432` | Primary text (14.6:1 on bg) |
| `--text-2` | `#58677D` | Secondary text (5.4:1 on bg) |
| `--text-3` | `#606D83` | Placeholder, meta, disabled (4.5:1 or more on bg, surface and surface-2; a quieter step than text-2). Never for body text |

### Neutrals: dark
Deep navy. Surfaces separate by a step in lightness and a 1 px `--line` hairline, never by shadows.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0B1019` | App background |
| `--surface` | `#1B2433` | Cards |
| `--surface-2` | `#121926` | The sidebar tone; hover fills, chips |
| `--line` | `#273246` | Hairlines |
| `--text` | `#F2F5FC` | Primary text (17.5:1 on bg) |
| `--text-2` | `#A7B2C4` | Secondary text (8.9:1 on bg) |
| `--text-3` | `#8390A4` | Meta (4.8:1 or more on bg, surface and surface-2) |

### Primary (the accent)
The primary is **Mawl violet `#7950E8`**, the same fill in both themes; white text on it is 5.1:1. Its accent ink, for small text, links and icons, is hand-picked per theme: `#5E32C5` in light and `#BDA4ED` in dark (7.7:1 and 7.2:1 on the card). The engine pins these values for the Mawl primary instead of deriving them (`mawlAccent` in `palette.ts`, `mawlScale` in `accent.ts`).

Until U9 replaces it with palettes, the user can still pick another accent in Settings → Appearance. The soft presets keep their fill and take ink text:

| Preset | Base (fill) | `--accent-ink`, light |
|---|---|---|
| **Mawl** (default) | `#7950E8` | `#5E32C5` (hand-picked) |
| Sky | `#A9D3F5` | `#4A718E` |
| Peach | `#F7C4A3` | `#906246` |
| Lilac | `#CBB9F4` | `#75649A` |
| Rose | `#F4B6C4` | `#945D6A` |
| Slate | `#B9C3CF` | `#666D78` |
| Custom | any | derived; the engine checks contrast |

Ink on every soft preset fill is 8.8:1 or better; every derived light `--accent-ink` is about 5.2:1 on the surface. In dark mode the soft presets are light enough to double as the ink. Retired presets (Lake, Moss, Amber, Coral, Plum, the old dark Slate, and Lime, the mochi's color) load as the default, by color, id or name (`apps/web/src/appearance/prefs.ts`).

**The accent engine** (`packages/ui/accent.ts`, using `culori`) turns one hex into a scale. It converts the hex to OKLCH and generates:
- `--accent` (base)
- `--accent-hover` (L −4%)
- `--accent-press` (L −8%)
- `--accent-soft`: the base mixed over the surface, 24% in light and 14% in dark. Used for selection, the current nav item and user bubbles.
- `--accent-softer`: half of that (12% light, 7% dark)
- `--accent-ring`: the focus ring, mixed from `--accent-ink` (100% light, 80% dark), so it reaches 3:1 on bg and surface even for pastel accents
- `--accent-fill`: background for filled buttons and the send button. For light accents the engine keeps the base and switches the text to ink, but only when ink is ≥ 6:1 on the base and still ≥ 4.5:1 on `--accent-hover` and `--accent-press`. Otherwise the fill is darkened in OKLCH L until **white text reaches ≥ 4.5:1**. Hover and press are derived from the fill.
- `--on-accent`: the text color on `--accent-fill`, white or ink (`--text` of the light theme), whichever passes 4.5:1
- `--accent-ink`: the accent as small text, an icon or a link. It is the base darkened (light) or lightened (dark) until it reaches ≥ 4.5:1 on bg, surface, surface-2 and the soft tint.
- `--accent` (base) is for fills, tints and decoration; text, icons and rings always use `--accent-ink`.

In dark mode the base L is raised to at least 0.68 so it stays readable, and the fill, hover, press and ink are derived from that raised base (the Mawl primary keeps its own fill and ink; only its `--accent` tint base is raised). The engine computes both scales at once and sets `--accent-light-{accent,hover,press,fill,on,ink}` and `--accent-dark-{…}`; the stylesheet maps `--accent` and friends to the right scale per theme, so a theme flip needs no JavaScript. Changing the accent is a CSS-variable swap, and colors tween over 320 ms (`transition: background-color, color`).

### Secondary (teal)
For status, online, the computer and success. Never for primary actions. `--secondary` is for fills and UI only (light `#087F86` is 4.46:1 on bg, under the text bar); `--secondary-ink` is the only teal text color.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--secondary` | `#087F86` | `#80DACE` | Dots, rings, icons, fills (≥ 3:1 on bg, surface and surface-2) |
| `--secondary-ink` | `#06767D` | `#80DACE` | Teal text (≥ 4.5:1 on bg, surface, surface-2 and the soft tint). Light is a step darker than the brand teal, which is 4.15:1 on the sidebar |
| `--secondary-soft` | 12 % over surface | same | Chips and badges behind teal text |

### shadcn/ui variables
`apps/web/src/styles.css` maps shadcn's semantic variables onto these tokens, so a component taken from the shadcn registry already speaks Mawl: `--background` → `--bg`, `--foreground` → `--text`, `--card`/`--popover` → `--surface`, `--primary` → `--accent-fill`, `--primary-foreground` → `--on-accent`, `--muted` → `--surface-2`, `--muted-foreground` → `--text-2`, `--destructive` → `--danger`, `--border`/`--input` → `--line`, `--ring` → `--accent-ring`, `--radius` → `--r-card`. Two shadcn names are not aliased because Mawl owns them: `--accent` is Mawl's brand color and `--secondary` is the teal. A pasted component that uses shadcn's neutral `bg-secondary` or `bg-accent` fill should use `bg-surface-2`. A test (`apps/web/src/ui/theme.test.ts`) keeps the mapping and the no-raw-hex rule honest.

### Semantic (fixed, never accent-driven)
- `--ok` `#007A4A` light, `#40B078` dark
- `--warn` `#985D00` light, `#D98A14` dark
- `--danger` `#C33632` light, `#F4766C` dark
- `--info` = accent

Each theme has its own value so the color reaches 4.5:1 as text on that theme's card and on its own `-soft` tint (12 % over the surface). The dark ok and danger were lifted for the navy card.

### Mascot colors (fixed)
The orb's colourways never follow the palette or the accent. They live with the mascot in `apps/web/src/mascot/ways.ts` (see §8), the only place these hex values exist. The old beaver and lime mascot tokens are gone from `packages/ui`.

## 4. Typography

| Role | Family | Notes |
|---|---|---|
| UI + body | **Figtree** (variable) | Friendly, open geometric sans, legible at small sizes. Not Inter |
| Display moments | **Bricolage Grotesque** (variable, opsz) | Only for onboarding headlines, empty-state lines and the wordmark. Never in dense UI |
| Code / logs | **JetBrains Mono** | Code blocks, terminal, tool args |

Scale (rem, 16 px base, ratio about 1.2):

| Token | Size / line-height | Weight |
|---|---|---|
| `display` | 2.25 / 1.1 | 650 |
| `title` | 1.375 / 1.25 | 620 |
| `heading` | 1.0625 / 1.35 | 600 |
| `body` | 0.9375 / 1.55 | 450 |
| `small` | 0.8125 / 1.45 | 500 |
| `micro` | 0.75 / 1.35 | 550 (timestamps, badges) |

Rules:
- Sentence case everywhere.
- No all-caps eyebrow labels.
- No `→` glyphs added to buttons.
- Chat text max width is 68ch.

## 5. Space, shape, elevation

- **Spacing:** 4 px base grid. Tokens 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56.
- **Radii: everything is round** (UI-REDESIGN §2).
  - `--r-pill` 999 for every interactive control: buttons, inputs and selects, tabs, chips, badges, toggles, avatars. Icon buttons and the send button are circles.
  - `--r-xs` 8 for inline code, `kbd` and skeleton lines
  - `--r-sm` 12 for menu rows and code blocks inside a card
  - `--r-md` 18 for notices and menus
  - `--r-card` 24 for cards and textareas (a several-line field reads as one soft card)
  - `--r-panel` 28 for panels and side sheets
  - `--r-dialog` 32 for dialogs, the window and the mobile sheet
  - Nested surfaces follow outer = inner + padding (a menu of 12 px rows with 6 px padding is 18).
- **Elevation:** avoid it mostly. Use surface contrast before shadows.
  - `--shadow-1: 0 1px 2px rgb(29 27 22 / .05)` for the composer, selected rows and popovers
  - `--shadow-2: 0 12px 32px -12px rgb(29 27 22 / .16)` for menus, dialogs and the floating computer preview
  - Dark mode uses a 1 px `--line` hairline instead of shadows.
  - Overlays behind dialogs, sheets and the palette are a soft wash of the background (`bg/70` with a 2 px blur), not grey.
- **Scrollbars:** slim overlay pills. A 10 px transparent track holds a fully round thumb (3 px transparent border, so it reads as a 4 px pill) with no arrow buttons. The thumb is invisible at rest and fades in over 200 ms while its scroller is hovered or has focus inside, in `--text-3` at low alpha (`--text-2` on thumb hover or drag). It is plain CSS in `styles.css`: the `::-webkit-scrollbar` path serves Chromium and WebView2, and `scrollbar-width`/`scrollbar-color` apply only under `@supports not selector(::-webkit-scrollbar)` (Chromium ignores the pseudo-elements once those are set). The messages and page scrollers reserve `scrollbar-gutter: stable`; dialogs, menus, the sidebar list and the context panel use `overscroll-behavior: contain`. Only the Jump to latest button scrolls smoothly, and not under reduced motion. The chat scroller is never wrapped in a JS scroll area, so stick-to-bottom stays native.
- **Layout (desktop):**
  1. Sidebar, 280 px, on the window background (`--bg`). Top to bottom: the word Mawl (display font, 24 px, no mascot) and a hide button; Search, Tools, Scheduled, Approvals; **Pinned** and **Teammates** groups; one bottom row with the profile button and a Settings gear. No New chat button, no icon rail. A 1 px `--line` on its right edge divides it from the conversation.
  2. Conversation (fluid): a flat, full-bleed pane on the same `--bg` as the sidebar: edge to edge, no tonal change, no radius, no inset, no outer border and no shadow.
  3. Context panel, 360 px, collapsible, flat on `--bg` with a faint 1 px `--line` on its left edge: Computer / Memory / Run. The header is only the segmented pill tabs (no title). Each tab has a calm `EmptyPanel` (round icon tile, title, one line, no mascot): Computer (monitor), Memory (book) and Run (activity; with a run it shows the tile and a few plain facts). Open or closed is remembered per browser (`mawl.panel`) and starts open. Below 1100 px it is a sheet, which is raised and so uses `--surface` and is never remembered.
  - The sidebar hides completely (`Ctrl+B` or the button); a round show button then appears in the page header. The choice is remembered.
  - Below 1100 px the context panel becomes a sheet. Below 760 px the sidebar is a left drawer with a rounded sheet edge opened from the header button. There is no bottom tab bar.

## 6. Iconography

Lucide icons at 1.75 stroke, 18 px in UI. Never use emoji as icons. Teammate avatars are the **still orb** (`MawlAvatar`: body and eyes, no effects, no motion) **in the teammate's colourway**, or an initial when there are many. The teammate's stored color picks the colourway (§8), and every colourway has its own ink, so the eyes always read.

## 7. Motion

Use existing libraries:
- **Motion** (`motion/react`) on web and desktop
- **Reanimated 3** + `moti` on mobile
- **Inline SVG** for Mawl: Motion springs and cross-fades for the eyes between states, CSS keyframes for the ambient loops (Rive is dropped for now, UI-REDESIGN.md §4)

Don't hand-roll animation engines.

| Token | Value | Use |
|---|---|---|
| `spring.gentle` | `{ type: 'spring', stiffness: 170, damping: 26 }` | Panels, sheets, layout shifts |
| `spring.snappy` | `{ stiffness: 420, damping: 34 }` | Toggles, tabs, chips |
| `spring.bouncy` | `{ stiffness: 260, damping: 14 }` | Celebrations, mascot hops, badge pop-in |
| `dur.fast` | 120 ms | Hover and press feedback |
| `dur.base` | 200 ms | Fades and color |
| `dur.slow` | 320 ms | Theme and accent change, page transitions |
| `ease.out` | `cubic-bezier(.2,.8,.2,1)` | Default tween |

Patterns:
- **Press:** scale 0.97 on press and spring back. Applies to buttons, cards and list rows.
- **Hover:** bg moves to `--surface-2` over 120 ms. No lifting cards.
- **Messages in:** opacity 0→1, y 6→0, using `spring.gentle`. Streaming text gets a soft caret pulse.
- **Tool activity:** the card enters collapsed. A thin progress shimmer runs while it works, then the icon changes to a check ✓ with a small `spring.bouncy` pop.
- **Approvals:** the badge count pops in. Approving collapses the card into a green line ("Approved · sent to Nora").
- **Shared-element transitions** (Motion `layoutId`): from the computer thumbnail to the full computer panel; from a teammate avatar to the chat header.
- **Accent change:** a 320 ms color tween plus a single ripple from the chosen swatch.
- **Exit faster than enter:** about 70% of the enter duration.
- **Reduced motion:** `prefers-reduced-motion` (and the in-app toggle) turns springs into 0-duration opacity fades and freezes the mascot on its pose frames.
- **Ambient motion** is limited to the mascot and the "live" dot on the computer thumbnail.

## 8. The mascot: Mawl

Mawl is **the orb**: one circle, one colourway, and glyph eyes that carry every expression. No mouth, no ears, no limbs; hats and accessories can sit on top later. It replaced the lemon-lime mochi in the 2026-10 orb redesign (PLAN U8). The art source is `design/assets/mascot-orb/build.mjs` (run `node build.mjs <dir>` for `sheet.html`); the code lives in `apps/web/src/mascot/` (`Mawl.tsx`, `MawlAvatar.tsx`, `glyphs.tsx`, `ways.ts`, `mawl.css`, `states.ts`, `mascot-state.ts`). `packages/mascot` is an empty placeholder package and holds none of it.

- **Style:** a 400-unit artwork, the orb at r 165. From 48 px up it has the **soft** treatment, a radial light at the top left (body lightened 22 % to body to body darkened 14 %). Below 48 px it is **flat**, cropped to the orb, without effects, and its eyes are drawn a third larger with thicker strokes so they read from 16 px (tray, list icons) up.
- **Colourways** (`ways.ts`), each a body and an ink for the eyes: lavender `#BDA4ED` / `#1B1233` (Mawl's own, the default), purple `#7950E8` / `#F2F5FC`, night `#1B2433` / `#BDA4ED`, teal `#80DACE` / `#0B2F33`, peach `#F8B79B` / `#3A1A10`, rose `#F4A9C0` / `#3A1021`, sky `#A9C8F4` / `#12264A`. A teammate wears the colourway its stored color maps to (`wayForColor`): an exact body, a legacy soft preset (Lime becomes lavender, Lilac purple, Slate night), else the nearest body.
- **Drawing:** one inline SVG per instance with gradient and clip ids from `useId`, so several orbs never share a `url(#…)`. Each state picks a left and right glyph, a resting look offset and at most one effect (`POSES` in `glyphs.tsx`). The effects (thought dots, `?!`, `z`) sit up and to the right, in the body color.
- **Eyes on a sphere:** one gaze (yaw and pitch, two Motion springs on `spring.gentle`) drives both eyes. Each eye is projected onto a sphere a little larger than the orb (`projectEye` in `idle-life.ts`): it moves along the curve and its glyph squashes as it turns away, so the trailing eye closes in on the leading one. The eyes sit in a group clipped to the orb circle, so a far look carries the leading eye over the outline and cuts it off, like a face turning on a ball. Transforms only, nothing re-renders per frame.
- **Idle life:** while `idle` (and, half as far and less often, while `listening`) the orb looks around on its own: every 2 to 5 s it may pick left, right, up-left, up-right or down (centre is the most likely), eases there, holds 0.6 to 1.8 s and comes back. It blinks every 3 to 6 s, sometimes twice, closing for 120 ms. The schedule takes an injectable clock (tests use fake timers), pauses while the tab is hidden, and never runs below 48 px or under reduced motion. There is no pointer tracking.
- **Motion:** eyes change through Motion: the new glyph pops in on `spring.bouncy` while the old one fades out over `dur.fast`, so a state change reads in under 100 ms. Ambient loops are CSS keyframes keyed on `data-state`, named `orb-*` so no other stylesheet's keyframe can override them. A clickable orb (48 px and up) scales to 1.03 on hover and 0.97 on press over `dur.fast`.
- **States:**

| State | When | Eyes | Motion and effect |
|---|---|---|---|
| `idle` | Nothing happening | Vertical bars | A slow breath; looks around and blinks on its own (idle life) |
| `listening` | The owner is typing | Shorter bars, glancing down at the composer | Breath; a quieter idle life |
| `thinking` | A run is queued or the model is generating | Rings, looking up and to the right | A gentle sway; two thought dots bob |
| `working` | Tools are running, or the context is compacting | Asterisks | The asterisks turn slowly |
| `waiting` | Needs approval, takeover or a reply | Plus signs | A floating `?!` |
| `done` | A watched run just succeeded (2.4 s) | `^ ^` | One hop as it lands in done |
| `oops` | A watched run just failed (2.4 s) | `x x` | A short shake, then a pause |
| `sleepy` | The run is paused, or a computer is asleep | Corner brackets | Slow deep breathing; rising `z` marks |

- **Click:** a large orb hops once. Small ones (under 48 px, like the chat header) don't.
- **Reduced motion:** the OS setting and the in-app toggle (through Motion's `MotionConfig`) stop every loop, the idle life (look-around and blinks), the hover scale and the hop; Mawl holds its pose with every effect shown at rest, and eye changes become short fades.
- **Still avatar:** `MawlAvatar` draws the orb and its eyes only, never moves, and shows the state through its eyes. It takes `way` or the teammate's `color`, and wears lavender without either.
- **Placement:**
  - the chat header (the focused teammate's state)
  - empty states and the new-chat landing
  - onboarding
  - desktop tray icon (monochrome glyph per state)
  - mobile tab-bar center
  - Telegram/Discord bot avatar
- The mascot never blocks content and never talks in modal popups. It is a presence, not Clippy.

### Image requests

The orb is drawn in code (`build.mjs`), so no mascot sheet and no onboarding illustration are needed. The **app icon** is the flat idle orb on a square tile: lavender on Mawl navy `#0B1019` (`design/assets/app-icon.svg`, the default and the Windows ICO) and purple on Mawl light `#F5F7FC` (`app-icon-light.svg`). Both come from `design/assets/mascot-orb/app-icon-*.svg`; the 1024 px PNGs beside them are rendered in the local Edge, and the desktop sizes in `apps/desktop/src-tauri/icons/` come from `pnpm exec tauri icon ../../design/assets/app-icon.png -o src-tauri/icons` run in `apps/desktop` (delete the `android/` and `ios/` folders it adds). The web build has no favicon yet. The **installer art** is drawn in code as well (the user waived the request for D1.7b) and still shows the mochi: "Mawl is moving in", a night river where Mawl drifts in inside an open moving box and waves under a lime moon, plus a round porthole onto the same scene for the white header strip. Sources `design/assets/installer/sidebar.svg` (164 x 314) and `header.svg` (150 x 57), with PNG previews beside them; after an edit, run `pnpm --filter @mawl/desktop art`, which renders them in the local Edge at 4x, area-averages to 1x and writes the 24-bit BMPs NSIS loads to `apps/desktop/src-tauri/installer/` (commit them; the header's left and top edges must stay pure white). Pending: the installer art redrawn with the orb, and tray art per status (`TODO(mascot)` in the tray code).

## 9. Components (inventory)

Build on Radix primitives in local shadcn components (`apps/web/src/ui/`, configured by `apps/web/components.json`). The shipped set: Button and IconButton, Dialog and Modal, Sheet, Tooltip, Input and Textarea, Switch, Tabs, Badge, Avatar, ScrollArea, Separator, DropdownMenu and the Sonner Toaster, plus two Mawl-made pieces: `IconTile` (a round `--surface-2` tile with one icon) and `EmptyPanel` (icon tile, title, one line, optional action) for empty lists and pages. The mascot appears only on the new-chat landing, in the chat header and as teammate avatars. To add one, read the registry source with `pnpm dlx shadcn@4.22.1 add <name> --view` (or `view <name>`) and adapt it by hand into a PascalCase file: relative imports, `cn` from `./cn.ts`, Mawl tokens, pill controls, `active:scale-[.97]`, 44 px `pointer-coarse:` targets. Don't run a plain `add`: it writes lowercase files with `@/` imports. Don't use Tailwind's `dark:` variant either; it follows the OS, not `data-theme`, and the tokens already switch per theme.

- **Navigation:** Sidebar (hideable; a drawer under 760 px), TeammateList (row: avatar, name, latest conversation line, time, live dot; unread pill once the API reports it; a ⋯ menu to pin), CommandPalette (cmdk): a centered round card (`--r-panel` 28, on `--surface`) over the soft wash. It opens with a pill search field on `--surface-2` that has no focus ring (the highlighted row shows where you are); rows are pills with an icon, a label and a right-aligned shortcut hint where one exists (hide or show the sidebar). Groups (Go to, Appearance, Layout) have sentence-case headings, the list scrolls with the global scrollbar, and an empty search says "Nothing found". Rows are 44 px under `pointer-coarse`.
- **Chat:**
  - Messages sit in one centered 720 px column. Assistant replies are plain on `--bg`, no bubble, at most 68ch wide. User messages are tail-less `--r-card` (24 px) bubbles on `--surface-2`, aligned right. Times show on hover or focus with a mouse and always on touch. Messages enter with opacity and y 6 to 0 on `spring.gentle`; streaming text ends in a soft caret pulse.
  - Markdown: code blocks are round `--surface` cards with a 1 px `--line`, the language and a Copy button, in JetBrains Mono; tables are round cards with a `--surface-2` header row.
  - Tool activity (`ToolActivity`): one round pill per run of tool calls ("Used 3 tools", "Used 2 tools, 1 didn't work") with a spinner, check or alert, and a thin shimmer while working. It expands into a card listing each step with its own status, arguments and result. Stored tool parts carry no timings yet, so no duration is shown.
  - Reasoning: a muted "Thinking" disclosure above the reply, closed by default.
  - Failed runs: an inline `--danger-soft` card that says what happened and how to fix it, with a "Try again" pill that resends the owner's last message (and a model settings link when the fix lives there).
  - ApprovalCard: action sentence, redacted args, and the buttons Approve / Deny / Open details.
  - TakeoverBanner.
  - Composer: a pill on `--surface` with a 1 px `--line` (plus `--shadow-1` in light). Its 28 px radius is a full pill at the thin one-line height of 44 px and reads as a soft card when the text wraps. Left a 32 px round ghost `+` menu (18 px icon; attachments show as a disabled "Attach files, soon" item until uploads exist), then the autosizing input (Enter sends, Shift+Enter adds a line) and a round 32 px send button (`--accent-fill`, 16 px `ArrowUp`, muted to `--surface-2` when empty, press scale .94; coarse pointers keep a 44 px hit area through a `before:` pseudo-element). The model is not in the composer: it shows in the header (below). While a run is going the send button becomes a round Stop button with a square icon. Focus draws a soft accent ring around the whole pill.
  - Header: show-sidebar button when needed, a small Mawl that mirrors the run, the teammate name with a one-line status, a quiet display-only model pill (model id in the mono font, title "credential / model id", hidden under 760 px), the conversation menu and the panel toggle. No border or shadow under it.
  - Scroll to latest: a small round `ArrowDown` button floats above the composer when the owner scrolls up; new text follows only while pinned to the bottom.
  - New chat (the empty state): a large Mawl (120 px, 88 px on phones; listening while the owner types), the Bricolage greeting "What's next, {first name}?" (or "What's next?"), the composer in the middle of the view and three soft suggestion pills under it that fill the composer without sending. Nothing else. After the first send the same composer docks to the bottom with a `spring.gentle` layout transition and Mawl moves into the header through a shared `layoutId`; reduced motion makes both instant.
- **Computer:**
  - ComputerThumbnail: a live 16:10 mini-screen with a "live" dot.
  - ComputerPanel: noVNC canvas, toolbar (Watch · Take control · Give back · Type a password · Fullscreen) and lease timer.
  - AgentCursorGhost.
- **Memory:** BlockCard (fill meter), FactRow, Timeline, SkillCard, DiffView.
- **Routines:** RoutineRow (natural-language summary, next run, toggle), RunHistory.
- **Settings:** one calm column inside the page frame. From 760 px a 200 px list of pill links (icon and name; the current one on `--surface-2` with an accent-ink icon) sits beside the open section; below 760 px the same links become one pill segmented track above it. The section lives in `?section=` (`appearance` is the bare `/settings`). Only sections that exist are listed, never "coming soon" ones. Each section has its own heading and one line, then round `--surface` cards (24 px, 20 px padding), each with a heading, one helper line and its control.
  - Appearance: Theme (a pill segmented control: Light, Dark, System), Accent color (round swatches Mawl, Sky, Peach, Lilac, Rose, Slate, then a conic Custom picker; one line under them names the choice, and for a custom color says Mawl adjusts text and focus rings so they stay readable) and Reduce motion (a switch).
  - Models and keys: each connected model is its own round card (mark, name, what it is, Check and Remove or Sign out), then one card per way to connect (ChatGPT plan, Claude plan with its steps opening inside the card, API key). Loading is a skeleton card, an unreachable server an inline card with Try again, and an empty list a card with an icon tile.
  - Later: Channels, Devices (QR pairing), Data.
- **New teammate dialog** (`NewTeammateDialog`): a 32 px dialog with pill Name and Model fields, a round `Select` for the model connection (a native select with the pill look and our own chevron), a 24 px Job textarea card, and soft Cancel and primary Create pills. Errors sit under their field and say how to fix it; Create reads "Creating…" and is disabled while the server works; a failed create shows a danger notice. Escape closes it and returns focus.
- **Your profile dialog** (from the sidebar's profile row, not part of Settings): Name and Personal context, saved on the server. The Save button reads "Saving…" while the save is in flight; the sidebar and greeting show the new name at once and roll back with a toast if the server refuses. Errors sit under their field ("Keep your name to 80 characters.", "Trim it by N characters.") and the context counter turns danger past 2000. Cancel and Escape drop the edits.
- **Feedback:** Toasts (Sonner, bottom-center, mascot glyph), Skeletons (soft shimmer, no spinners in lists), Inline errors that say how to fix the problem.

## 10. Key screens

1. **Onboarding (3 steps):** Welcome, then Connect a model, then Name your first teammate, then Pair your phone (skippable).
   - Large Bricolage headline and the mascot.
   - A progress row of three dots.
   - The river wave at the bottom; it advances with each step through a horizontal wave-offset animation.
2. **Home / chat:** the three panes. The header shows the teammate name, status ("working · 3 steps"), a computer thumbnail and a ⋯ menu.
3. **Computer:** the panel is expanded and the chat collapses to a narrow side column. "Take control" puts an accent ring around the screen.
4. **Approvals:** a pill control with Needs you (default) and Activity; Needs you is an inbox list grouped by teammate, with an inline decision on each. Tools (Connections, Skills, Plugins) and Scheduled share the same page frame (title, one-line subtitle, centered column) and, until their data exists, an icon-tile empty state.
5. **Activity:** a day-grouped timeline of sentences, filterable.
6. **Memory:** tabs for Blocks / Facts / Timeline / Skills, plus an overnight changes card at the top.
7. **Routines:** a list with natural-language summaries and next run times. "New routine" opens a sheet with an NL input that turns into a parsed schedule preview.
8. **Settings:** as in the inventory above.
9. **Mobile:**
   - Tab bar: Teammates · Activity · (mascot center, quick ask) · Approvals · Settings.
   - Chat is full screen.
   - Computer is landscape-aware with a keyboard bar.

## 11. Accessibility checklist (blocking for review)

- Text contrast ≥ 4.5:1, UI components ≥ 3:1, in both themes and with all accent presets.
- Visible focus: a 2 px `--accent-ring` with a 2 px offset. Never remove outlines. The one exception is the composer text field (and its pill): the caret shows focus there, so it draws no ring; the composer's buttons keep theirs.
- Everything is reachable by keyboard; the chat list uses roving focus. Icon buttons have `aria-label`.
- Touch targets ≥ 44 px on mobile; ≥ 8 px gap between targets. On the web the size follows the input, not the width: `pointer-coarse:` raises buttons, segments, swatches and tabs to 44 px, while mouse users keep the denser sizes. A control that must stay visually small (the switch) widens its hit area with a `before:` pseudo-element.
- Streaming messages use `aria-live="polite"` (throttled); approvals use `role="alertdialog"` only when blocking.
- Reduced motion is respected. No information is carried by color alone (status = icon + text).
