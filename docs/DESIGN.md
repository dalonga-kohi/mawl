# Mawl — Design System

> Calm, lowkey, gentle and a little playful. The UI stays quiet so the work and the mascot can speak.

> **2026-10-21 redesign: [UI-REDESIGN.md](UI-REDESIGN.md) wins over this file** on palette, mascot (now **Mawl**, a lemon-lime mochi, not the brown beaver Pip), shape (everything round), shell layout and the shadcn component base. Sections 3, 5 (layout), 6 (avatars), 8 and 9 are being rewritten slice by slice (PLAN U1 to U7). Since U1, §3 (colors and accent) and §5 (shape and elevation) follow the redesign.

The reference mood is the airy blue/white Telegram concepts plus a quiet dark mode. They show direction only; we don't copy them. When you do frontend work, apply the **ui-taste**, **frontend-design** and **ui-ux-pro-max** skills on top of this document. This document wins on any conflict.

## 1. Concept: "the lodge by the river"

A beaver builds a lodge in a quiet river. Mawl's teammates work in their lodge, and you check in from the bank. That gives us:
- **Water** (cool, airy neutrals and a soft blue default accent): the calm surface.
- **Wood** (the beaver's warm brown, used *only* on the mascot and a few tiny highlights): warmth and character.
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
| `--bg` | `#FAF8F4` | App background |
| `--surface` | `#FFFFFF` | Panels, cards, composer |
| `--surface-2` | `#F2EFE8` | Sidebar, hover fills, tab tracks |
| `--line` | `#E7E3DA` | Hairlines (use sparingly) |
| `--text` | `#1D1B16` | Primary text (16.2:1 on bg) |
| `--text-2` | `#5E5A50` | Secondary text (6.5:1 on bg) |
| `--text-3` | `#8C877B` | Placeholder, meta, disabled (3.6:1 on surface). Never for body text |

### Neutrals: dark ("Ink")
Near-black and neutral, not blue. Surfaces separate by a step in lightness and a 1 px `--line` hairline, never by shadows.

| Token | Hex |
|---|---|
| `--bg` | `#0B0B0D` |
| `--surface` | `#131315` |
| `--surface-2` | `#1B1B1E` |
| `--line` | `#26262A` |
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
| Name | Hex | Use |
|---|---|---|
| Fur | `#8B5E3C` | Body |
| Fur light | `#B07D52` | Belly and cheeks |
| Tail | `#5B3D28` | Tail with crosshatch |
| Tooth | `#FFF7E6` | Teeth |
| Nose/eye | `#2A1E16` | Nose and eyes |
| Blush | `#F2A38F` | Optional cheek blush |

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
  - `--r-md` 18 for message bubbles, notices, menus and textareas
  - `--r-card` 24 for cards
  - `--r-panel` 28 for panels and side sheets
  - `--r-dialog` 32 for dialogs, the window and the mobile sheet
  - Nested surfaces follow outer = inner + padding (a menu of 12 px rows with 6 px padding is 18).
- **Elevation:** avoid it mostly. Use surface contrast before shadows.
  - `--shadow-1: 0 1px 2px rgb(29 27 22 / .05)` for the composer, selected rows and popovers
  - `--shadow-2: 0 12px 32px -12px rgb(29 27 22 / .16)` for menus, dialogs and the floating computer preview
  - Dark mode uses a 1 px `--line` hairline instead of shadows.
  - Overlays behind dialogs, sheets and the palette are a soft wash of the background (`bg/70` with a 2 px blur), not grey.
- **Layout (desktop):**
  1. Rail, 64 px: icons for Teammates, Activity, Approvals, Memory, Routines, Settings, with the mascot at the top.
  2. Teammate list, 280 px.
  3. Conversation (fluid).
  4. Context panel, 360 px, collapsible: Computer / Memory / Run.
  - Below 1100 px the context panel becomes a sheet. Below 760 px the layout switches to the mobile single-column one.

## 6. Iconography

Lucide icons at 1.75 stroke, 18 px in UI and 20 px in the rail. Never use emoji as icons. Teammate avatars are a rounded square holding a **mini beaver head tinted by the teammate's color**, or an initial when there are many.

## 7. Motion

Use existing libraries:
- **Motion** (`motion/react`) on web and desktop
- **Reanimated 3** + `moti` on mobile
- **Rive** for the mascot
- **Lottie** only if a Rive asset isn't available

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

## 8. The mascot: Pip the beaver

The name "Pip" is a working name; other options are Bodhi, Timber, Bóbr and Chip. The final pick is the user's.

- **Style:** small, flat vector, chunky rounded shapes, 2–3 tones, no outlines (or a 1.5 px darker-fur outline at small sizes). Big friendly eyes, two prominent cream teeth, a flat crosshatched tail. Reads well at 16 px (tray) up to 240 px (onboarding).
- **States** (one Rive state machine with input `state`, plus SVG fallbacks):

| State | When | Motion |
|---|---|---|
| `idle` | Nothing happening | Slow blink every 4–7 s, a tiny breathing bob |
| `listening` | The user is typing | Ears perk, head tilts toward the composer |
| `thinking` | Model is generating | Eyes look up, a small thought dot pulses |
| `working` | Tools are running | Gnaws a little log; wood chips drift |
| `waiting` | Needs approval or takeover | Holds up a small sign with "!" and a gentle wave |
| `done` | Run succeeded | Tail-slap and a sparkle (`spring.bouncy`) |
| `sleeping` | Profile idle or sandbox suspended | Curled up with "z" bubbles |
| `error` | Run failed | Ears droop, a small sweat drop; recovers to idle |

- **Placement:**
  - top of the rail (current focused teammate's state)
  - empty states
  - onboarding
  - desktop tray icon (monochrome glyph per state)
  - mobile tab-bar center
  - Telegram/Discord bot avatar
- The mascot never blocks content and never talks in modal popups. It is a presence, not Clippy.

### Image requests

Ask the user for the images below. Until they arrive, the mockup uses an inline SVG placeholder beaver.

1. **Mascot turnaround and state sheet:**
   > "Cute minimal flat vector mascot of a small beaver named Pip for a calm productivity app. Chunky rounded geometric shapes, no outlines, 3-tone warm brown fur (#8B5E3C, #B07D52, #5B3D28), cream teeth (#FFF7E6), big friendly dark eyes, flat crosshatched paddle tail. Character sheet on a plain white background showing 8 poses in a grid: idle smiling, ears perked listening, looking up thinking with a small thought dot, gnawing a small log with wood chips, holding a tiny sign with an exclamation mark, happy tail slap with sparkle, curled up sleeping with z's, sad with droopy ears. Consistent proportions, Dribbble-quality, modern, simple, vector, no text, no gradients, no shadows."
2. **App icon:**
   > "App icon, rounded square, soft lake-blue (#3D8BFD) to lighter blue background with a subtle flowing water wave at the bottom, centered front-facing head of a cute minimal flat vector beaver (warm brown #8B5E3C, cream teeth), friendly smile, simple geometric shapes, no text, high-contrast silhouette that reads at 16px, modern macOS/iOS icon style."
3. **Onboarding illustration:**
   > "Wide minimal flat vector illustration, calm river scene in airy pale blues and white, a small cute beaver (warm brown, cream teeth) sitting on a little log lodge with a laptop, soft flowing wave lines, lots of negative space, gentle and friendly, no text, no gradients heavier than two-stop, modern productivity app onboarding style."

Ask the user for a Rive file later; or build the state machine from the delivered sheet. Use https://rive.app, and don't write a custom animation runtime.

## 9. Components (inventory)

Build on Radix primitives in local shadcn components (`apps/web/src/ui/`, configured by `apps/web/components.json`). The shipped set: Button and IconButton, Dialog and Modal, Sheet, Tooltip, Input and Textarea, Switch, Tabs, Badge, Avatar, ScrollArea, Separator, DropdownMenu and the Sonner Toaster. To add one, read the registry source with `pnpm dlx shadcn@4.22.1 add <name> --view` (or `view <name>`) and adapt it by hand into a PascalCase file: relative imports, `cn` from `./cn.ts`, Mawl tokens, pill controls, `active:scale-[.97]`, 44 px `pointer-coarse:` targets. Don't run a plain `add`: it writes lowercase files with `@/` imports. Don't use Tailwind's `dark:` variant either; it follows the OS, not `data-theme`, and the tokens already switch per theme.

- **Navigation:** Rail, TeammateList (row: avatar, name, last activity line, time, unread pill, live dot), CommandPalette (cmdk).
- **Chat:**
  - Message bubbles. Assistant messages are plain on `--bg` and span the full text width. User messages are `--accent-soft` bubbles aligned right with `--r-md`.
  - ToolActivityCard: a collapsed sentence with an expandable step list. Shows ✓, spinner or ! and the duration.
  - ApprovalCard: action sentence, redacted args, and the buttons Approve / Deny / Open details.
  - TakeoverBanner.
  - Composer: autosizing input, attach, model chip, send (accent), and a stop button while streaming.
  - Empty state: the mascot with suggested prompts as soft chips.
- **Computer:**
  - ComputerThumbnail: a live 16:10 mini-screen with a "live" dot.
  - ComputerPanel: noVNC canvas, toolbar (Watch · Take control · Give back · Type a password · Fullscreen) and lease timer.
  - AgentCursorGhost.
- **Memory:** BlockCard (fill meter), FactRow, Timeline, SkillCard, DiffView.
- **Routines:** RoutineRow (natural-language summary, next run, toggle), RunHistory.
- **Settings:**
  - Appearance (theme segmented control, accent swatches + custom picker, reduced-motion toggle)
  - Models & keys, Connections, Channels, Devices (QR pairing), Data.
- **Feedback:** Toasts (Sonner, bottom-center, mascot glyph), Skeletons (soft shimmer, no spinners in lists), Inline errors that say how to fix the problem.

## 10. Key screens

1. **Onboarding (3 steps):** Welcome, then Connect a model, then Name your first teammate, then Pair your phone (skippable).
   - Large Bricolage headline and the mascot.
   - A progress row of three dots.
   - The river wave at the bottom; it advances with each step through a horizontal wave-offset animation.
2. **Home / chat:** the three panes. The header shows the teammate name, status ("working · 3 steps"), a computer thumbnail and a ⋯ menu.
3. **Computer:** the panel is expanded and the chat collapses to a narrow side column. "Take control" puts an accent ring around the screen.
4. **Approvals:** an inbox list grouped by teammate, with an inline decision on each.
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
- Visible focus: a 2 px `--accent-ring` with a 2 px offset. Never remove outlines.
- Everything is reachable by keyboard; the chat list uses roving focus. Icon buttons have `aria-label`.
- Touch targets ≥ 44 px on mobile; ≥ 8 px gap between targets. On the web the size follows the input, not the width: `pointer-coarse:` raises buttons, segments, swatches and tabs to 44 px, while mouse users keep the denser sizes. A control that must stay visually small (the switch) widens its hit area with a `before:` pseudo-element.
- Streaming messages use `aria-live="polite"` (throttled); approvals use `role="alertdialog"` only when blocking.
- Reduced motion is respected. No information is carried by color alone (status = icon + text).
