# Mawl — UI redesign decision record (2026-10-21)

> This record **wins over [DESIGN.md](DESIGN.md)** wherever they disagree (colors, mascot, shell layout, shape). DESIGN.md keeps the parts this record doesn't touch: principles, typography, motion tokens, accessibility. It is updated slice by slice as the redesign lands.

## 1. Why

The first UI was correct but plain: a 64 px icon rail, a brown beaver, a blue accent and a dark mode that was too light and too blue. The new direction is **comforting, playful, intuitive and mindful**, and still uncrowded. References: a centered composer, a near-black dark mode and the user's own desktop mockup (aesthetics only; it is too crowded).

## 2. Decisions

| Topic | Decision |
|---|---|
| Component library | **shadcn/ui** (Radix + Tailwind 4, already in the repo), plus AI Elements for chat parts where they fit. Each component is edited to fit Mawl, not used as shipped. shadcn's CSS variables (`--background`, `--primary` …) are mapped onto our tokens, so `packages/ui` stays the single source of truth |
| Shape | Everything is round. Interactive controls are pills (buttons, chips, inputs, composer, tabs, toggles); the send button is a circle. Cards 24, panels 28, dialogs and the window 32 |
| Mascot | **Mawl** (renamed from Pip): a mochi blob with two round ears and a small paddle tail. No teeth, no species detail. Ported from the user's mint reference (`faire_mint_state_animations.html`): SVG + CSS keyframes, 6 states |
| Mawl color | Lemon-lime / pistachio, base about `#D8E88A`; not alert yellow. It is also the default app accent |
| Neutrals | True-dark and warm cream (below). Dark mode is near-black with hairline borders, not shadows |
| Sidebar | Hideable. Search · Tools · Scheduled · Approvals, then **Pinned**, then **Teammates** (one row per teammate), then at the bottom Settings and the user profile |
| Workspace | The existing collapsible right panel stays (Computer · Memory · Files · Run). Memory is per teammate, so it lives here |
| New chat | Centered large idle Mawl, a short greeting, a pill composer with `+` and a round send button, soft suggestion pills. After the first send the composer docks to the bottom and Mawl shrinks into the chat header |
| Profile | The profile row opens a dialog with the user's **name** and **personal context** (what Mawl should always know about them) |

## 3. Palette (starting values; each is contrast-checked by the accent/token tests before it ships)

### Neutrals
| Token | Light "Cream" | Dark "Ink" |
|---|---|---|
| `--bg` | `#FAF8F4` | `#0B0B0D` |
| `--surface` | `#FFFFFF` | `#131315` |
| `--surface-2` | `#F2EFE8` | `#1B1B1E` |
| `--line` | `#E7E3DA` | `#26262A` |
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
│ Mawl wordmark     [hide]    │ header: avatar · name · status    │ Computer · Memory · Files · Run  │
│ [+ New chat]                │         thread ▾ · panel toggle   │                                  │
│ Search                      │                                   │                                  │
│ Tools                       │   messages / landing              │                                  │
│ Scheduled                   │                                   │                                  │
│ Approvals (count)           │   ( pill composer   ● send )      │                                  │
│ ─ Pinned                    │                                   │                                  │
│ ─ Teammates                 │                                   │                                  |
│                             │                                   │                                  │
│ Settings   · profile        │                                   │                                  │
└─────────────────────────────┴───────────────────────────────────┴──────────────────────────────────┘
```

- **Hide:** the toggle (and `Ctrl+B`) collapses the sidebar to a 64 px round-icon rail; the choice is remembered. Below 760 px the sidebar is a drawer and the bottom tab bar returns.
- **Teammate row:** tinted mini Mawl, name, one-line last message, time, unread pill, live dot. Right-click or the `⋯` menu: pin, rename, archive. Pinned teammates float into Pinned.
- **Activity** (the old rail item) becomes a tab on the Approvals page: "Needs you" and "Activity". **Routines** is renamed **Scheduled** in the UI (the code keeps `routines`). **Memory** moves into the workspace panel (per teammate); the cross-teammate overview is reached from Tools.
- **Tools page:** tabs Connections (MCP appears only in the detail view, per the plain-words rule), Skills, Plugins. Each is a list of round cards with an on/off toggle and an "Add" flow.
- **Settings** gets a left list of sections: Appearance, Models and keys, Channels, Devices, Data. The profile dialog is separate from Settings.

## 6. Slices

U1 to U7 in [PLAN.md](PLAN.md). Each is a UI slice and goes to `head-coder` (CLAUDE.md: all frontend work).

## 7. Open items and follow-ups

- Pip rename: `packages/mascot`, `apps/web/src/mascot/Beaver.tsx`, docs, `DESIGN.md` §8 and any copy. Done in U2.
- Personal context from the profile dialog feeds the `human` core memory block (D4.1). Until D4 lands it is stored as a user setting, and U6 adds the small contract for it (a contract change, so it is a hard slice and gets a head-reviewer proposal).
- The onboarding illustration and app icon prompts in DESIGN §8 are obsolete. Mawl is code-drawn from the reference SVG, so only an app icon is still needed; the user will generate it from a new prompt once Mawl is final.
