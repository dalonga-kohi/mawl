# Mawl — Design System

> Calm, lowkey, gentle and a little playful. The UI stays quiet so the work and the mascot can speak.

> **2026-10-21 redesign: [UI-REDESIGN.md](UI-REDESIGN.md) wins over this file** on palette, mascot (now **Mawl**, a lemon-lime mochi, not the brown beaver Pip), shape (everything round), shell layout and the shadcn component base. Sections 3, 5 (layout), 6 (avatars), 8 and 9 are being rewritten slice by slice (PLAN U1 to U7). Since U1, §3 (colors and accent) and §5 (shape and elevation) follow the redesign.

The reference mood is the airy blue/white Telegram concepts plus a quiet dark mode. They show direction only; we don't copy them. When you do frontend work, apply the **ui-taste**, **frontend-design** and **ui-ux-pro-max** skills on top of this document. This document wins on any conflict.

## 1. Concept: "Mawl keeps watch"

Mawl, a soft lemon-lime mochi, keeps watch while your teammates work, and you check in whenever you like. That gives us:
- **Calm surfaces** (quiet neutrals, see UI-REDESIGN.md §3): the backdrop.
- **Mochi** (Mawl's fixed lemon-lime palette, used on the mascot and a few tiny highlights; lime is also the default accent): warmth and character.
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

### Neutrals: light ("Cream")
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FAF8F4` | The whole window: sidebar, conversation, pages and workspace panel (one tone) |
| `--surface` | `#FFFFFF` | Raised things only: composer, cards, popovers, dialogs, tool cards, code blocks |
| `--surface-2` | `#F2EFE8` | Hover fills, tab tracks, user bubbles |
| `--line` | `#E7E3DA` | Hairlines (use sparingly) |
| `--text` | `#1D1B16` | Primary text (16.2:1 on bg) |
| `--text-2` | `#5E5A50` | Secondary text (6.5:1 on bg) |
| `--text-3` | `#8C877B` | Placeholder, meta, disabled (3.6:1 on surface). Never for body text |

### Neutrals: dark ("Ink")
Near-black and neutral, not blue. Surfaces separate by a step in lightness and a 1 px `--line` hairline, never by shadows.

| Token | Hex |
|---|---|
| `--bg` | `#060607` |
| `--surface` | `#0D0D0F` |
| `--surface-2` | `#151517` |
| `--line` | `#1E1E22` |
| `--text` | `#ECECEE` |
| `--text-2` | `#A6A6AD` |
| `--text-3` | `#6F6F77` |

### Accent (user-selectable)
The user picks the accent in Settings → Appearance. The default is **Lime**, Mawl's own color. Every preset is a soft, light color of about the same lightness, so filled buttons keep the preset as their fill and take ink text.

| Preset | Base (fill) | `--accent-ink`, light | Mood |
|---|---|---|---|
| **Lime** (default) | `#D8E88A` | `#687309` | Mawl's pistachio; fresh, gentle |
| Sky | `#A9D3F5` | `#4A718E` | Airy, calm |
| Peach | `#F7C4A3` | `#906346` | Warm, friendly |
| Lilac | `#CBB9F4` | `#76649A` | Playful |
| Rose | `#F4B6C4` | `#945D6A` | Soft, kind |
| Slate | `#B9C3CF` | `#666D78` | Ultra-lowkey |
| Custom | any | derived | A color picker; the engine checks contrast |

Ink on every preset fill is 9.6:1 or better; every light `--accent-ink` is about 5.2:1 on the surface. In dark mode the presets are already light enough, so the base doubles as the ink. The pre-redesign presets (Lake, Moss, Amber, Coral, Plum and the old dark Slate) are retired: a saved preference that still holds one of them, by color, id or name, loads as Lime (`apps/web/src/appearance/prefs.ts`).

**The accent engine** (`packages/ui/accent.ts`, using `culori`) turns one hex into a scale. It converts the hex to OKLCH and generates:
- `--accent` (base)
- `--accent-hover` (L −4%)
- `--accent-press` (L −8%)
- `--accent-soft`: the base mixed over the surface, 24% in light and 14% in dark (soft accents barely tint a light surface at less). Used for selection, the current nav item and user bubbles.
- `--accent-softer`: half of that (12% light, 7% dark)
- `--accent-ring`: the focus ring, mixed from `--accent-ink` (100% light, 80% dark), so it reaches 3:1 on bg and surface even for pastel accents
- `--accent-fill`: background for filled buttons and the send button. For light accents (all presets), the engine keeps the base and switches the text to ink, but only when ink is ≥ 6:1 on the base and still ≥ 4.5:1 on `--accent-hover` and `--accent-press` (they are darker, and ink loses contrast as the fill darkens). Otherwise (a mid blue like `#3D8BFD`, or a coral) the fill is darkened in OKLCH L until **white text reaches ≥ 4.5:1**. Hover and press are derived from the fill.
- `--on-accent`: the text color on `--accent-fill`, white or ink (`--text` of the light theme), whichever passes 4.5:1
- `--accent-ink`: the accent as small text, an icon or a link. It is the base darkened (light) or lightened (dark) until it reaches ≥ 4.5:1 on bg, surface, surface-2 and the soft tint.
- `--accent` (base) is for fills, tints and decoration. With soft accents it is too light to read on a light surface, so text, icons and rings always use `--accent-ink`.

In dark mode the base L is raised to at least 0.68 so it stays readable, and the fill, hover, press and ink are all derived from that raised base. The engine computes both scales at once and sets `--accent-light-{accent,hover,press,fill,on,ink}` and `--accent-dark-{…}`; the stylesheet maps `--accent` and friends to the right scale per theme, so a theme flip needs no JavaScript. Changing the accent is a CSS-variable swap, and colors tween over 320 ms (`transition: background-color, color`).

### shadcn/ui variables
`apps/web/src/styles.css` maps shadcn's semantic variables onto these tokens, so a component taken from the shadcn registry already speaks Mawl: `--background` → `--bg`, `--foreground` → `--text`, `--card`/`--popover` → `--surface`, `--primary` → `--accent-fill`, `--primary-foreground` → `--on-accent`, `--secondary`/`--muted` → `--surface-2`, `--muted-foreground` → `--text-2`, `--destructive` → `--danger`, `--border`/`--input` → `--line`, `--ring` → `--accent-ring`, `--radius` → `--r-card`. shadcn's own `--accent` (a neutral hover fill) is not aliased: `--accent` is Mawl's brand color, and that role is `--secondary`. A test (`apps/web/src/ui/theme.test.ts`) keeps the mapping and the no-raw-hex rule honest.

### Semantic (fixed, never accent-driven)
- `--ok` `#007A4A` light, `#32A16A` dark
- `--warn` `#985D00` light, `#D98A14` dark
- `--danger` `#C33632` light, `#EF6056` dark
- `--info` = accent

The light values are darker so they reach 4.5:1 as text on white and on their own `-soft` tint. One hex cannot pass on both white and the dark surface, so each theme has its own.

Each has a `-soft` variant at 12% alpha.

### Mascot palette (fixed)
Mawl's colors are fixed and never follow the accent. They are CSS variables (`--mawl-*`) defined with the mascot in `apps/web/src/mascot/mawl.css`, the only place these hex values live.

| Name | Hex | Use |
|---|---|---|
| Body | `#E4F09A` → `#BFD45E` | Body gradient (also the waiting paw and working chips) |
| Ear / ear inner | `#D2E47A` / `#A8BE4A` | Ears; the inner tone also colors the thinking dots |
| Tail | `#A4BC48` → `#869B36` | Tail gradient |
| Ink | `#26301A` | Eyes, mouth, the "!" and a 13 % ground shadow |
| Blush / tongue | `#FF9AA8` | Cheeks at 40 %, the open mouth's tongue |
| Sparkle | `#F6D66B` | Done sparkles, the waiting bubble |
| Sweat | `#8FD3F4` | The oops sweat drop |

The old beaver tokens (`--fur`, `--fur-light`, `--tail`, `--tooth`, `--nose`, `--blush`) in `packages/ui` are unused and retire with the U1 token rework.

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

Lucide icons at 1.75 stroke, 18 px in UI. Never use emoji as icons. Teammate avatars are a round neutral chip holding the **simplified Mawl** (body, ears and eyes; no mouth, no tail) **in the teammate's color**, or an initial when there are many. The tint keeps the teammate's hue at Mawl's lightness, so the dark eyes always read.

## 7. Motion

Use existing libraries:
- **Motion** (`motion/react`) on web and desktop
- **Reanimated 3** + `moti` on mobile
- **Inline SVG + CSS keyframes** for Mawl, with CSS transitions between states (Rive is dropped for now, UI-REDESIGN.md §4)

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

Mawl is a soft lemon-lime mochi: a round blob with two round ears and a small paddle tail. No teeth and no species detail. It is ported from the user's approved mint reference and recolored with the palette in §3. Code: `apps/web/src/mascot/` (`Mawl.tsx`, `MawlAvatar.tsx`, `mawl.css`, `states.ts`, `mascot-state.ts`).

- **Style:** flat vector, a two-stop body gradient, no outlines. Short vertical-bar eyes, a small smile and pink blush. Readable from 16 px (tray, list icons) to 240 px (onboarding). Below 48 px it crops to the body and drops its effects and shadow; at 20 px or less the eyes get heavier.
- **Drawing:** one inline SVG per instance with ids from `useId`, so several Mawls on a page never share a gradient or clip path. Each state turns on one set of eyes, one mouth and at most one effect (`POSES` in `Mawl.tsx`); the motion is CSS keyframes keyed on `data-state`, and face parts cross-fade over `dur.fast` when the state changes.
- **States** (UI-REDESIGN.md §4):

| State | When | Motion |
|---|---|---|
| `idle` | Nothing happening | Breathing squish, tail wag, a blink every ~3 s. At 64 px and up the eyes follow the pointer (at most once per frame) |
| `listening` | The owner is typing | Eyes glance down at the composer, ears perk |
| `thinking` | A run is queued or the model is generating | Head tilt, eyes up and to the side, wavy mouth, three bobbing dots |
| `working` | Tools are running, or the context is compacting | Quick bob, tail slap, focused eyes, chips drift off |
| `waiting` | Needs approval, takeover or a reply | A small "!" bubble and a slow wave of a raised paw |
| `done` | A watched run just succeeded (2.4 s) | Hop with a ground shadow, happy eyes, open smile, sparkles |
| `oops` | A watched run just failed (2.4 s) | Shake, round eyes, a sweat drop |
| `sleepy` | The run is paused, or a computer is asleep | Slow deep breathing, closed eyes, floating "z" |

- **Click:** a large Mawl hops once. Small ones (the sidebar header) don't.
- **Reduced motion:** the OS setting and the in-app toggle (through Motion's `MotionConfig`) freeze Mawl on its pose: no loops, no pointer follow, no hop, with every effect shown at rest.
- **Simplified avatar:** `MawlAvatar` draws the body, ears and eyes only, never moves, and shows the state through its eyes. It wears the teammate's color at Mawl's lightness, or Mawl's own lime without one.
- **Placement:**
  - the sidebar header (the focused teammate's state)
  - empty states and the new-chat landing
  - onboarding
  - desktop tray icon (monochrome glyph per state)
  - mobile tab-bar center
  - Telegram/Discord bot avatar
- The mascot never blocks content and never talks in modal popups. It is a presence, not Clippy.

### Image requests

Mawl is drawn in code from the reference, so no mascot sheet and no onboarding illustration are needed. The **app icon** is drawn in code too, at the user's request: Mawl tilted 8° and cropped by the bottom edge on a rounded near-black tile with a soft lime glow and three gold sparkles, no paw. Source `design/assets/app-icon.svg` (PNG renders `app-icon.png` and a light variant `app-icon-light.png`); the desktop sizes in `apps/desktop/src-tauri/icons/` come from `pnpm exec tauri icon design/assets/app-icon.png`. The Windows ICO and the Dock icon use the black version; the light one is for a light-theme tray or the web. Nothing is pending for images except tray art per status (`TODO(mascot)` in the tray code).

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
  - Appearance: Theme (a pill segmented control: Light, Dark, System), Accent color (round swatches Lime, Sky, Peach, Lilac, Rose, Slate, then a conic Custom picker; one line under them names the choice, and for a custom color says Mawl adjusts text and focus rings so they stay readable) and Reduce motion (a switch).
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
