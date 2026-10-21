# Mawl — Product Spec

> **Mawl** (French: *to do, to make*). AI teammates you own. They work on your machine and keep working while you sleep.

Status: v0.1 draft · Last updated: 2026-10-17

## 1. Problem

Most hosted agent products pick the model for you, run in someone else's cloud, share one computer across every bot, and hide what the agent remembers. Self-hosted options exist, but they still ask for a lot of setup and treat memory, the visible computer, mobile control and chat channels as separate add-ons.

Mawl is a single self-hosted product with:
- **Your keys, your model, your machine.** Any provider: Anthropic, OpenAI, OpenRouter, or a local model through Ollama.
- **Always on.** Agents run in a Docker stack, so closing the app doesn't stop them.
- **A computer you can watch.** Each profile has a sandboxed Linux desktop. You can watch it live and take control.
- **Memory that lasts for weeks.** Long-running agents don't drown in context, and you can see and edit everything they remember.
- **Control from anywhere.** Desktop, phone, Telegram and Discord all drive the same agents.
- **Minimal setup.** One command, then a 3-step onboarding.

## 2. Personas

| Persona | Needs |
|---|---|
| **The maker** (primary): developer and power user who self-hosts | Agents that do real work (research, inbox, code chores, monitoring), any model, everything visible, phone control |
| **Busy pro**: technical enough to run Docker | "Set it and forget it" routines, approvals on the phone, a clear audit trail |
| **Tinkerer**: runs local models | Ollama support, custom MCP servers, editable skills and memory |

## 3. Glossary

- **Profile (teammate / bot):** an isolated agent identity. It has its own persona, model, tools/MCP, memory, skills, sandbox computer, channel tokens, routines and approval policy. In the UI it is called a *teammate*.
- **Run:** one execution of the agent loop, triggered by a message, a routine, the heartbeat, or another teammate.
- **Routine:** a scheduled or triggered task, defined by cron or natural language.
- **Heartbeat:** a cheap periodic wake-up that checks a `HEARTBEAT` checklist and either acts or stays quiet.
- **Computer:** the profile's sandbox container. It has a desktop, browser, shell and files.
- **Takeover:** the user takes an exclusive control lease on the computer.
- **Approval:** a pending action that needs a human decision under the policy.
- **Channel:** a place you talk to Mawl: the desktop/web app, the mobile app, Telegram, or Discord.

## 4. Feature list (MoSCoW)

### Must (v1)
| ID | Feature | Notes |
|---|---|---|
| F1 | **Chat with a teammate** | Streaming responses; tool-activity cards (collapsible, human-readable, e.g. "Archived 26 newsletters"); attachments; markdown/code |
| F2 | **Multi-provider models** | Anthropic, OpenAI, OpenRouter, Ollama, plus any OpenAI-compatible endpoint. Each profile has a main model and a cheap "helper" model |
| F3 | **Profiles** | Create, clone, archive. Persona (`SOUL`), avatar color, model, tools, policy. Full isolation |
| F4 | **MCP connections** | Add stdio (runs inside the sandbox) or HTTP/SSE servers, with OAuth for remote MCP. Per-profile enablement and per-tool policy. Includes a curated catalog |
| F5 | **Built-in tools** | Shell, files, browser (Playwright MCP), desktop control (screenshot/act), web search/fetch, memory tools, `request_takeover`, `ask_user`, `message_teammate`, schedule tools |
| F6 | **Background runs** | Runs keep going after the UI closes. Queue, pause, resume, cancel. Activity feed |
| F7 | **Routines** | Cron or natural language ("every weekday at 7, sweep my inbox"). Run history. Delivery channel per routine |
| F8 | **Heartbeat** | Optional per profile, default every 30 min. Checks a user-editable checklist. Stays silent unless something needs doing |
| F9 | **Memory system** | Pinned core blocks, episodic log, semantic facts, skills. Hybrid recall. Automatic compaction and handoff. **Fully viewable and editable in the UI.** See [MEMORY.md](MEMORY.md) |
| F10 | **Sandbox computer** | A Docker container per profile with a desktop, Chromium, shell and files. Persistent home volume |
| F11 | **Watch & take control** | Live desktop stream in the app. "Take control" / "Give back". The agent can ask for takeover (e.g. logins, 2FA, CAPTCHA). A secure credential form lets you type secrets into the sandbox without the model ever seeing them |
| F12 | **Approvals & policy** | Each action class gets a level: auto / ask / hand off / block. Defaults: sends, purchases, deletes and payments are ask. Approvals arrive on every channel |
| F13 | **Mobile app** | Pair by QR code. Chat, approvals, activity, watch/take control, push notifications. Reaches the server over LAN or Tailscale |
| F14 | **Telegram & Discord** | Per-profile bot tokens. Chat, approve, check status and run routines from the chat. Owner allowlist. Token locks |
| F15 | **Onboarding** | Three steps: provider key (or detect Ollama) → name your first teammate → pair your phone (optional). The beaver guides you |
| F16 | **Accent color & theme** | Light, dark or system theme. Six accent presets plus a custom color |
| F17 | **Activity & audit log** | Every tool call, approval, takeover and memory write is recorded and searchable |

### Should (v1.x)
| ID | Feature |
|---|---|
| S1 | Teammate-to-teammate delegation and group chats (2–6 teammates) |
| S2 | Sentinel: an independent guard model that reviews outbound actions before they run |
| S3 | Teach by demonstration: record yourself doing a task in the sandbox browser and turn it into a draft routine or skill |
| S4 | Skill library: import Agent Skills (SKILL.md standard), with auto-proposed skills in an approval queue |
| S5 | Voice: speak to a teammate (STT/TTS with your own keys) |
| S6 | End-to-end encrypted relay for remote access without Tailscale |
| S7 | Cost and token dashboard per profile, with budgets and caps |

### Could (later)
Slack/WhatsApp/Email channels · WebRTC streaming (neko/Selkies) · remote sandbox providers (E2B, Daytona, SSH) · run on your *local* computer as a trusted fallback · plugin marketplace · multi-user households.

### Won't (v1)
Multi-tenant SaaS hosting · Windows/macOS sandbox images · training or fine-tuning models.

## 5. Key user stories and acceptance criteria

1. **First run.** *As a new user I run one command and finish onboarding in under 3 minutes.*
   - `docker compose up -d` (or the install script) brings up a healthy stack.
   - The app opens to onboarding, and a validated key leads to a first reply in under 10 s.
2. **Background inbox sweep.** *I ask "clean my inbox every weekday at 7" and close the laptop.*
   - A routine is created and confirmed in plain language.
   - The run executes on schedule with the app closed.
   - A summary arrives on the chosen channel.
   - Sends wait for approval.
3. **Takeover for login.** *The agent hits a 2FA page.*
   - It calls `request_takeover` with a reason, and the run enters `waiting_takeover`.
   - Phone and desktop get a notification.
   - I open the live screen, take control and sign in, then give control back, and the run resumes.
4. **Approval from Telegram.** *A pending "send email" approval shows up in Telegram with Approve / Deny / View buttons.* Approving there resolves it everywhere.
5. **Long task, no amnesia.** *A teammate works on a multi-day research task.*
   - Context never overflows: it compacts automatically, writes handoff notes, and starts fresh windows.
   - After 3 days it still recalls decisions from day 1, and I can see which memory it used.
6. **Edit memory.** *I open Memory → Facts, find a wrong fact and correct it.* The edit is versioned, and the agent uses the corrected fact next turn.
7. **Connect MCP.** *I paste an MCP URL (or choose one from the catalog), finish OAuth, and pick which tools need approval.*
8. **Accent color.** *I pick "Moss" in Settings.* The whole UI, including mobile, retints smoothly, and the mascot stays brown.

## 6. Non-functional requirements

- **Setup:** one command, no edits to `.env` (secrets are generated on first boot), and the stack is healthy in under 2 minutes on a fresh machine after images are pulled.
- **Reliability:**
  - Runs are durable. A crashed server resumes queued and interrupted runs from their last checkpoint.
  - Jobs are idempotent.
  - Supervised processes restart on crash.
- **Security:**
  - Secrets are encrypted at rest (libsodium, with the key in a Docker secret or volume).
  - The sandbox has no access to the Docker socket.
  - Screen and terminal access go through a token-gated gateway.
  - Prompt-injection scanning on memory writes and tool output.
  - Never put secrets in URLs.
  - Device pairing uses one-time tokens.
- **Performance:**
  - First token under 1.5 s after the provider responds.
  - UI interactions at 60 fps.
  - Memory recall p95 under 150 ms.
  - Screen stream under 300 ms latency on LAN.
- **Context efficiency:** a stable prompt prefix (caching) and a context budget per run. See MEMORY.md.
- **Accessibility:** WCAG 2.2 AA contrast, full keyboard navigation, `prefers-reduced-motion` honoured, 44 px touch targets on mobile.
- **Privacy:** no telemetry by default. Everything stays on the user's machine except calls to their chosen model provider.
- **Platforms:** server on any Docker host (x64 and arm64). Desktop on Windows, macOS and Linux. Mobile on iOS and Android.

## 7. Non-goals and anti-patterns we deliberately avoid

- Opaque memory you can't view or edit.
- All bots sharing one computer and its sign-ins. Mawl gives each profile its own container.
- Model lock-in.
- Dashboards cluttered with stats. Calm first.

## 8. Success metrics (for us)
- Time-to-first-useful-run under 5 min.
- A 7-day continuous run without manual context resets.
- At least 90% of approvals answered from mobile or chat channels.
- No crash loops in a 72 h soak test.
