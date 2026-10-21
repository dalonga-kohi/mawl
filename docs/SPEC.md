# Mawl — Product Spec

> **Mawl** (French: *to do, to make*). AI teammates you own. They work on your machine and keep working while you sleep.

Status: v0.2 draft · Last updated: 2026-10-21 (desktop-first redesign, see [REDESIGN.md](REDESIGN.md))

## 1. Problem

Most hosted agent products pick the model for you, run in someone else's cloud, share one computer across every bot, and hide what the agent remembers. Self-hosted options exist, but they still ask for a lot of setup and treat memory, the visible computer, mobile control and chat channels as separate add-ons.

Mawl is a single self-hosted product with:
- **Your keys, your model, your machine.** Any provider: Anthropic, OpenAI, OpenRouter, or a local model through Ollama.
- **Install and go.** One Windows installer, then a 3-step onboarding. No terminal, no Docker needed to start chatting.
- **Always on.** Mawl lives in the tray and starts at login. Closing the window doesn't stop your teammates, and schedules catch up after the laptop sleeps.
- **A computer you can watch.** Give a teammate a sandboxed Linux computer: a light terminal one, or a desktop one with a real browser. You can watch it live and take control. This is the one feature that needs Docker Desktop.
- **A great agent loop.** Tools, skills, MCP and plugins on one loop that works the same with every provider, with a carefully built system prompt.
- **Memory that lasts for weeks.** Long-running agents don't drown in context, and you can see and edit everything they remember.
- **Control from anywhere (later).** Telegram and Discord first, then the phone app over Tailscale.

## 2. Personas

| Persona | Needs |
|---|---|
| **The everyday power user** (primary): installs apps, doesn't use a terminal | Install and go; agents that do real work (research, inbox, monitoring); "set it and forget it" routines; approvals as notifications; a clear audit trail |
| **The maker**: developer who self-hosts | Any model, everything visible, computers for code chores, headless mode on a home server, custom skills and plugins |
| **Tinkerer**: runs local models | Ollama support, custom MCP servers, editable skills and memory |

## 3. Glossary

- **Profile (teammate / bot):** an isolated agent identity. It has its own persona, model, tools/MCP, memory, skills, sandbox computer, channel tokens, routines and approval policy. In the UI it is called a *teammate*.
- **Run:** one execution of the agent loop, triggered by a message, a routine, the heartbeat, or another teammate.
- **Routine:** a scheduled or triggered task, defined by cron or natural language.
- **Heartbeat:** a cheap periodic wake-up that checks a `HEARTBEAT` checklist and either acts or stays quiet.
- **Computer:** a Mawl sandbox container (Docker). Kind *terminal* (shell, files, headless browser) or *desktop* (adds a visible desktop and browser). A teammate has none, its own, or one shared with other teammates.
- **Skill:** a `SKILL.md` folder of instructions (and optional scripts) a teammate loads when a task needs it.
- **Plugin:** a bundle of skills, MCP servers, prompt blocks and routine templates.
- **Receipt:** a routine's definition of done, checked after each run.
- **Trace:** a compiled script from a successful routine run, replayed without the model except at its "holes".
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
| F4 | **MCP connections** | Add stdio (runs inside the teammate's computer) or HTTP/SSE servers, with OAuth for remote MCP. Per-profile enablement and per-tool policy. Many tools are deferred behind a tool search. Includes a curated catalog |
| F5 | **Built-in tools** | Shell, files, browser (Playwright MCP), desktop control (screenshot/act), web search/fetch, memory tools, `skill_load`, `tool_search`, `delegate` (subagent), `request_takeover`, `ask_user`, `notify`, schedule tools |
| F6 | **Background runs** | Runs keep going after the window closes. Queue, pause, resume, cancel. Message a teammate mid-run (steering). Activity feed |
| F7 | **Routines** | Cron, intervals, one-shot reminders, or natural language ("every weekday at 7, sweep my inbox"), always confirmed. Missed-run policy after sleep or shutdown. Receipts. Run history. Delivery channel per routine |
| F8 | **Heartbeat** | Optional per profile, default every 30 min. Checks a user-editable checklist. Stays silent unless something needs doing |
| F9 | **Memory system** | Pinned core blocks, episodic log, semantic facts, skills. Hybrid recall. Automatic compaction and handoff. **Fully viewable and editable in the UI.** See [MEMORY.md](MEMORY.md) |
| F10 | **Computers** | Optional, needs Docker Desktop. Create a terminal or desktop computer, or attach a teammate to an existing Mawl computer. Persistent home volume, auto-suspend, reset. The app detects Docker and guides the install |
| F11 | **Watch & take control** | Live desktop stream in the app. "Take control" / "Give back". The agent can ask for takeover (e.g. logins, 2FA, CAPTCHA). A secure credential form lets you type secrets into the sandbox without the model ever seeing them |
| F12 | **Approvals & policy** | Each action class gets a level: auto / ask / hand off / block. Defaults: sends, purchases, deletes and payments are ask. Approvals arrive on every channel |
| F14 | **Telegram & Discord** | Per-profile bot tokens over long polling (no inbound networking). Chat, approve, check status and run routines from the chat. Owner allowlist. Token locks |
| F15 | **Onboarding** | Windows installer, then three steps: provider (Continue with ChatGPT, an API key, Ollama, or the Claude plan) → name your first teammate → done. A computer is offered later. The beaver guides you |
| F16 | **Accent color & theme** | Light, dark or system theme. Six accent presets plus a custom color |
| F17 | **Activity & audit log** | Every tool call, approval, takeover and memory write is recorded and searchable |
| F18 | **Desktop host** | The app runs the server and its database itself: tray icon, starts at login, close-to-tray, Windows notifications. Headless mode (Docker or a plain process) serves the same web app |
| F19 | **Skills** | Agent Skills (`SKILL.md`) per teammate, loaded on demand, editable in the UI. Proposed skills wait in an approval queue |

### Should (v1.x)
| ID | Feature |
|---|---|
| S1 | Teammate-to-teammate delegation and group chats (2–6 teammates) |
| S2 | Sentinel: an independent guard model that reviews outbound actions before they run |
| S3 | Teach by demonstration: record yourself doing a task in the sandbox browser and turn it into a draft routine or skill |
| S4 | Local plugin import (folder or zip): skills, MCP configs, prompt blocks, routine templates |
| S5 | Voice: speak to a teammate (STT/TTS with your own keys) |
| S6 | Remote access: Tailscale serve first, an own end-to-end encrypted relay later |
| S7 | Cost and token dashboard per profile, with budgets and caps |
| S8 | **Trace compiler:** a routine run that passed its receipt becomes a script with model "holes", self-healing one broken step at a time |
| S9 | **Mobile app** (old F13): pair by QR code; chat, approvals, activity, watch/take control, push notifications; over Tailscale |

### Could (later)
Mawl marketplace (plugins, skills) · Slack/WhatsApp/Email channels · WebRTC streaming (neko/Selkies) · remote sandbox providers (E2B, Daytona, SSH) · macOS and Linux desktop builds · multi-user households.

### Won't (v1)
Multi-tenant SaaS hosting · Windows/macOS sandbox images · attaching arbitrary (non-Mawl) Docker containers · training or fine-tuning models.

## 5. Key user stories and acceptance criteria

1. **First run.** *As a new user I download the installer and finish onboarding in under 3 minutes, without Docker or a terminal.*
   - The installer needs no admin rights. Mawl opens to onboarding while its database prepares behind the splash.
   - A validated provider leads to a first reply in under 10 s.
2. **Background inbox sweep.** *I ask "clean my inbox every weekday at 7" and close the window.*
   - A routine is created and confirmed in plain language.
   - The run executes on schedule with the window closed (Mawl in the tray).
   - If the laptop slept through 7:00, the run happens once on wake (the default missed-run policy).
   - A summary arrives as a Windows notification or on the chosen channel.
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
9. **Give a teammate a computer.** *I open a teammate's computer card.*
   - Without Docker: Mawl explains why it's needed, links the installer and detects when Docker is running.
   - With Docker: I pick "new terminal computer", "new desktop computer" or an existing Mawl computer; the image downloads with progress, and the teammate's next run has shell and files (and a visible desktop for the desktop kind).
10. **Steer mid-run.** *While a teammate works, I type "skip the PDFs".* The message reaches the running loop at its next step, without starting a new run.

## 6. Non-functional requirements

- **Setup:** one per-user installer, no configuration files (secrets are generated on first run), and a first chat in under 3 minutes on a fresh machine. Docker is needed only for computers. Headless mode keeps `docker compose up -d` with no `.env` edits beyond the database password.
- **Reliability:**
  - Runs are durable. A crashed server resumes queued and interrupted runs from their last checkpoint.
  - Jobs are idempotent.
  - Supervised processes restart on crash.
- **Security:**
  - Secrets are encrypted at rest (libsodium, with the key in Windows Credential Manager on desktop, or a secrets volume in headless mode).
  - The local server requires a per-launch token even on loopback, so other local programs and web pages can't drive it.
  - Computers have no access to the Docker engine, the database or the host, and publish no ports.
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
- **Platforms:** desktop on Windows 11 x64 first (macOS and Linux later). Headless server on any Docker host (x64 and arm64). Computers need Docker Desktop (WSL2 backend). Mobile on iOS and Android, later.

## 7. Non-goals and anti-patterns we deliberately avoid

- Opaque memory you can't view or edit.
- All bots silently sharing one computer and its sign-ins. In Mawl a new computer is per teammate by default; sharing one is an explicit, visible choice.
- "Install Docker first" as the price of entry.
- Model lock-in.
- Dashboards cluttered with stats. Calm first.

## 8. Success metrics (for us)
- Time-to-first-useful-run under 5 min.
- A 7-day continuous run without manual context resets.
- At least 90% of approvals answered from a notification or a chat channel, without opening the full app.
- No crash loops in a 72 h soak test.
