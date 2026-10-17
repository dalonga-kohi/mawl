# Faire — Design System

> Calm, lowkey, gentle and a little playful. The UI stays quiet so the work and the beaver can speak.

The reference mood is the airy blue/white Telegram concepts plus a quiet dark mode. They show direction only; we don't copy them. When you do frontend work, apply the **ui-taste**, **frontend-design** and **ui-ux-pro-max** skills on top of this document. This document wins on any conflict.

## 1. Concept: "the lodge by the river"

A beaver builds a lodge in a quiet river. Faire's teammates work in their lodge, and you check in from the bank. That gives us:
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

All colors are CSS variables in `packages/ui/tokens`. Components never use raw hex.

### Neutrals: light ("Mist")
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#F5F7FA` | App background |
| `--surface` | `#FFFFFF` | Panels, cards, composer |
| `--surface-2` | `#EEF2F6` | Sidebar, hover fills, input bg |
| `--line` | `#E1E6EC` | Hairlines (use sparingly) |
| `--text` | `#17202B` | Primary text (15.3:1 on bg) |
| `--text-2` | `#5A6675` | Secondary text (5.45:1 on bg) |
| `--text-3` | `#8A95A3` | Placeholder, meta, disabled (3.0:1 on surface only; 2.8:1 on bg). Never for body text |

### Neutrals: dark ("Night river")
| Token | Hex |
|---|---|
| `--bg` | `#0F141A` |
| `--surface` | `#161C24` |
| `--surface-2` | `#1D2530` |
| `--line` | `#26303C` |
| `--text` | `#E8EDF3` |
| `--text-2` | `#A3AEBB` |
| `--text-3` | `#6E7A88` |

### Accent (user-selectable)
The user picks the accent in Settings → Appearance. The default is **Lake**.

| Preset | Hex | Mood |
|---|---|---|
| **Lake** (default) | `#3D8BFD` | Airy, trustworthy (reference blue) |
| Moss | `#3FA36B` | Calm, natural |
| Amber | `#E09A1E` | Warm, energetic |
| Coral | `#EF6F5E` | Friendly |
| Plum | `#8E6BE8` | Playful |
| Slate | `#5B6B82` | Ultra-lowkey |
| Custom | any | A color picker; the engine checks contrast |

**The accent engine** (`packages/ui/accent.ts`, using `culori`) turns one hex into a scale. It converts the hex to OKLCH and generates:
- `--accent` (base)
- `--accent-hover` (L −4%)
- `--accent-press` (L −8%)
- `--accent-soft` (base at 12% alpha over surface; used for selection and tinted bubbles)
- `--accent-softer` (6%)
- `--accent-ring` (40% alpha)
- `--accent-fill`: background for filled buttons and the send button. It is the base accent, darkened in OKLCH L until **white text reaches ≥ 4.5:1**. Lake `#3D8BFD` only reaches 3.3:1 with white, so its fill is about `#2473E3`. For light accents like Amber, the engine keeps the base and switches the text to ink instead, but only when ink is ≥ 6:1 on the base and still ≥ 4.5:1 on `--accent-hover` and `--accent-press` (they are darker, and ink loses contrast as the fill darkens). Otherwise (Coral, for example) the fill is darkened until white passes. Hover and press are derived from the fill.
- `--on-accent`: the text color on `--accent-fill`, white or `--text`, whichever passes 4.5:1
- `--accent-ink`: the accent as small text or a link on `--surface`. It is the base darkened (light) or lightened (dark) until it reaches ≥ 4.5:1 on the theme's surface.
- `--accent` (base) is used for text links, icons, focus rings, selection and tints. When it is used as text on `--surface` it must reach 3:1 for large/UI text, or use `--accent-fill` for small text.

In dark mode the base L is raised to at least 0.68 so it stays readable, and the fill, hover, press and ink are all derived from that raised base. The engine computes both scales at once and sets `--accent-light-{accent,hover,press,fill,on,ink}` and `--accent-dark-{…}`; the stylesheet maps `--accent` and friends to the right scale per theme, so a theme flip needs no JavaScript. Changing the accent is a CSS-variable swap, and colors tween over 320 ms (`transition: background-color, color`).

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
- **Radii, by hierarchy:**
  - `--r-xs` 6 for chips and badges
  - `--r-sm` 10 for inputs and buttons
  - `--r-md` 14 for cards and messages
  - `--r-lg` 20 for panels and sheets
  - `--r-xl` 28 for the window and the mobile sheet
  - `999` for pills, avatars and toggles
- **Elevation:** avoid it mostly. Use surface contrast before shadows.
  - `--shadow-1: 0 1px 2px rgb(16 24 40 / .05)` for the composer and popovers
  - `--shadow-2: 0 8px 24px -8px rgb(16 24 40 / .12)` for menus, dialogs and the floating computer preview
  - Dark mode uses a 1 px `--line` border instead of shadows.
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

Build on Radix primitives in local shadcn-style components.

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
- Touch targets ≥ 44 px on mobile; ≥ 8 px gap between targets.
- Streaming messages use `aria-live="polite"` (throttled); approvals use `role="alertdialog"` only when blocking.
- Reduced motion is respected. No information is carried by color alone (status = icon + text).
