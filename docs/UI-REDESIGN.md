# Mawl — UI redesign decision record (2026-10-21)

> This record **wins over [DESIGN.md](DESIGN.md)** wherever they disagree (colors, mascot, shell layout, shape). DESIGN.md keeps the parts this record doesn't touch: principles, typography, motion tokens, accessibility. It is updated slice by slice as the redesign lands.

## 1. Why

The first UI was correct but plain: a 64 px icon rail, a brown beaver, a blue accent and a dark mode that was too light and too blue. The new direction is **comforting, playful, intuitive and mindful**, and still uncrowded. References: a centered composer, a near-black dark mode and the user's own desktop mockup (aesthetics only; it is too crowded).

## 2. Decisions

| Topic | Decision |
|---|---|
| Component library | **shadcn/ui** (Radix + Tailwind 4, already in the repo), plus AI Elements for chat parts where they fit. Each component is edited to fit Mawl, not used as shipped. shadcn's CSS variables (`--background`, `--primary` …) are mapped onto our tokens, so `packages/ui` stays the single source of truth |
| Shape | Everything is round. Interactive controls are pills (buttons, chips, inputs, composer, tabs, toggles); the send button is a circle. Cards 24, panels 28, dialogs 32. The window itself is flat: the conversation is full-bleed with no inset or radius |
| Mascot | **Mawl** (renamed from Pip): a mochi blob with two round ears and a small paddle tail. No teeth, no species detail. Ported from the user's mint reference (`faire_mint_state_animations.html`): SVG + CSS keyframes, 6 states |
| Mawl color | Lemon-lime / pistachio, base about `#D8E88A`; not alert yellow. It is also the default app accent |
| Neutrals | True-dark and warm cream (below). Dark mode is near-black with hairline borders, not shadows |
| One tone | The whole window is one tone (user decision, 2026-10-22): the sidebar, the conversation, pages and the workspace panel all sit on `--bg`, with no tonal change between them. `--surface` is only for raised things: the composer, cards, popovers, dialogs, tool cards and code blocks |
| Sidebar | **No icon rail, only a sidebar.** It is hideable (fully hidden, not collapsed to icons). The top row is the name "Mawl" (display font, 24 px, weight 650, no mascot beside it) and the hide button. Search · Tools · Scheduled · Approvals, then **Pinned**, then **Teammates** (one row per teammate), then one compact bottom row: the profile button (round initial avatar and name) on the left and a round Settings gear on the right. There is no New chat button; chats start from a teammate |
| Workspace | The existing collapsible right panel stays (Computer · Memory · Files · Run). Memory is per teammate, so it lives here |
| New chat | Centered large idle Mawl, a short greeting, a pill composer with `+` and a round send button, soft suggestion pills. After the first send the composer docks to the bottom and Mawl shrinks into the chat header |
| Profile | The profile row opens a dialog with the user's **name** and **personal context** (what Mawl should always know about them) |

## 3. Palette (starting values; each is contrast-checked by the accent/token tests before it ships)

### Neutrals
| Token | Light "Cream" | Dark "Ink" |
|---|---|---|
| `--bg` | `#FAF8F4` | `#060607` |
| `--surface` | `#FFFFFF` | `#0D0D0F` |
| `--surface-2` | `#F2EFE8` | `#151517` |
| `--line` | `#E7E3DA` | `#1E1E22` |
| `--text` | `#1D1B16` | `#ECECEE` |
| `--text-2` | `#5E5A50` | `#A6A6AD` |
| `--text-3` | `#8C877B` | `#6F6F77` |

### Accent
- Default accent **Lime** `#D8E88A`. It is a light accent, so the accent engine keeps the base for fills and switches the text on it to ink (`--on-accent`), per DESIGN §3. `--accent-ink` (small accent text) is darkened until it reaches 4.5:1 on the surface.
- Presets are re-tuned to the same softness: Lime (default), Sky, Peach, Lilac, Rose, Slate, plus Custom. The old Lake, Moss, Amber and Coral names retire.

### Mawl (fixed, derived from the mint reference)
| Part | Hex |
|---|---|
| Body gradient | `#E4F09A` → `#BFD45E` |
| Ears (outer / inner) | `#D2E47A` / `#A8BE4A` |
| Tail gradient | `#A4BC48` → `#869B36` |
| Eyes and mouth | `#26301A` |
| Blush | `#FF9AA8` at 40 % |
| Sparkle (done) | `#F6D66B` |

In chat lists and as teammate avatars Mawl is **simplified**: body, ears and eyes only, no mouth and no tail, tinted by the teammate's color. The default teammate color is Mawl's own lime.

## 4. The mascot states

The mint reference has six states. We keep them and add two that DESIGN §8 needs.

| State | Used when | Motion (from the reference) |
|---|---|---|
| `idle` | Nothing happening | Breathing squish, tail wag, blink every ~3 s, eyes follow the pointer |
| `thinking` | Model generating | Head tilt, wavy mouth, three bobbing dots |
| `working` | Tools running | Bob, tail slap, small chips drift off |
| `done` | Run succeeded | Hop with a shadow, open smile, sparkles |
| `oops` | Run failed | Shake, round eyes, a sweat drop |
| `sleepy` | Idle profile / suspended computer | Slow breathing, closed eyes, floating "z" |
| `listening` (new) | The user is typing | Eyes shift toward the composer |
| `waiting` (new) | Needs approval or takeover | A small "!" bubble and a slow wave |

Rive is dropped for now: SVG + CSS keyframes (and Motion for state-to-state transitions) are enough and ship today. `prefers-reduced-motion` freezes the mascot on its pose. D9.1 becomes polish only.

## 5. Shell layout (desktop)

```
┌─ Sidebar 280 px (hideable) ─┬─ Conversation (fluid, 68ch text) ─┬─ Workspace 360 px (collapsible) ─┐
│ (mawl) Mawl       [hide]    │ header: avatar · name · status    │ Computer · Memory · Files · Run  │
│                             │         thread ▾ · panel toggle   │                                  │
│ Search                      │                                   │                                  │
│ Tools                       │   messages / landing              │                                  │
│ Scheduled                   │                                   │                                  │
│ Approvals (count)           │   ( pill composer   ● send )      │                                  │
│ ─ Pinned                    │                                   │                                  │
│ ─ Teammates                 │                                   │                                  |
│                             │                                   │                                  │
│ (S) Sam              (gear) │                                   │                                  │
└─────────────────────────────┴───────────────────────────────────┴──────────────────────────────────┘
```

- **Flat panes, one tone:** the sidebar, the conversation and the workspace all sit on `--bg`, flat, with no radius, inset or outer border. A single faint 1 px `--line` divides sidebar from conversation (on the sidebar's right edge) and conversation from workspace (on the workspace's left edge). Controls inside stay round, and raised things (composer, cards, menus) use `--surface`. The mobile drawer and the workspace sheet are overlays, so they keep `--surface` and their rounded edge.
- **Bottom row:** one row, no divider. The profile button fills it and opens the Your profile dialog; the 36 px Settings gear (44 px on touch) links to `/settings` and turns accent-ink on `--surface-2` when active.
- **Hide:** the toggle (and `Ctrl+B`) hides the sidebar completely; a small round button in the conversation header brings it back. The choice is remembered. There is no icon rail anywhere. Below 760 px the sidebar is a drawer opened from the header button (no bottom tab bar).
- **Teammate row:** tinted mini Mawl, name, one-line last message, time, unread pill, live dot. Right-click or the `⋯` menu: pin, rename, archive. Pinned teammates float into Pinned.
- **Mascot placement:** Mawl appears only on the new-chat landing, in the chat header and as teammate avatars. Empty states elsewhere (pages, the Computer panel) use a round icon tile (`IconTile` and `EmptyPanel` in `ui/`).
- **Activity** (the old rail item) becomes a tab on the Approvals page: "Needs you" (default) and "Activity", kept in `?tab=`. `/activity` redirects to `/approvals?tab=activity`. **Routines** is renamed **Scheduled** in the UI (the code keeps `routines`). **Memory** moves into the workspace panel (per teammate); the cross-teammate overview is reached from Tools.
- **Tools page:** a pill segmented control with Connections (default), Skills and Plugins, kept in `?tab=` (an unknown value opens Connections); `/connections` redirects to `/tools?tab=connections`. MCP appears only in a row's detail view, per the plain-words rule. Each tab will be a list of round rows with an on/off toggle and an "Add" flow; until D2.8 (skills), D2.9 (connections) and D9.3 (plugin import) land, each shows an icon-tile empty state and no dead buttons.
- **Scheduled page** (`/routines`): an empty state with an "Open a chat" link until D5.5 fills it.
- **Settings** (U6) has a left list of pill links, a pill segmented track below 760 px, kept in `?section=`. Today it lists Appearance and Models and keys; Channels, Devices and Data join when they exist, never as empty tabs. Every section is a few round `--surface` cards. The profile dialog is separate from Settings and saves to the server (`user.update`).
- **Teammate colors:** a new teammate takes the next soft preset in turn, Lime first, so the first one wears Mawl's own color. Existing teammates keep their stored color.

## 6. Slices

U1 to U7 in [PLAN.md](PLAN.md). Each is a UI slice and goes to `head-coder` (CLAUDE.md: all frontend work).

## 7. Open items and follow-ups

- Pip rename: `packages/mascot`, `apps/web/src/mascot/Beaver.tsx`, docs, `DESIGN.md` §8 and any copy. Done in U2.
- Personal context from the profile dialog feeds the `user` core memory block (MEMORY.md §2, D4.1). U6 added `user.get` / `user.update` and the single-row `user_profile` table (migration 0006); D4.1 decides how its 2000 characters seed the 1500-character block.
- The onboarding illustration and app icon prompts in DESIGN §8 are obsolete. Mawl is code-drawn from the reference SVG, so only an app icon is still needed; the user will generate it from a new prompt once Mawl is final.

## 8. Overall feel (user note, 2026-10-22)

The whole app, not only the shell, must move toward the references: generous air, near-black dark mode, soft round surfaces, quiet type, one centered column, few borders. Every slice U3 to U7 is judged against the reference screenshots, not only against the checklist. Cut anything that crowds.
