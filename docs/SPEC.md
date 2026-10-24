# Mawl — Product Spec

> **Mawl** (French: *to do, to make*). AI teammates you own. They work on your machine and keep working while you sleep.

Status: v0.3 draft · Last updated: 2026-10-24 (projects, This PC and teammate requests, see [REDESIGN.md](REDESIGN.md) §12; desktop-first redesign 2026-10-21)

## 1. Problem

Most hosted agent products pick the model for you, run in someone else's cloud, share one computer across every bot, and hide what the agent remembers. Self-hosted options exist, but they still ask for a lot of setup and treat memory, the visible computer, mobile control and chat channels as separate add-ons.

Mawl is a single self-hosted product with:
- **Your keys, your model, your machine.** Any provider: Anthropic, OpenAI, OpenRouter, or a local model through Ollama.
- **Install and go.** One Windows installer, then a 3-step onboarding. No terminal, no Docker needed to start chatting.
- **Always on.** Mawl lives in the tray and starts at login. Closing the window doesn't stop your teammates, and schedules catch up after the laptop sleeps.
- **Works on your PC.** A teammate can work on your own files, in the folders you grant it, with no Docker. Shell commands and file changes wait for your approval by default.
- **A computer you can watch.** Give a teammate a sandboxed Linux computer: a light terminal one, or a desktop one with a real browser. You can watch it live and take control. This is the one feature that needs Docker Desktop.
- **Projects your teammates share.** A project holds your brief, guidelines and voice, brand, reference files and folders. Every teammate you add to it works with that context, and teammates can ask each other for help.
- **A great agent loop.** Tools, skills, MCP and plugins on one loop that works the same with every provider, with a carefully built system prompt. Connecting an MCP server is a search and a click.
- **Memory that lasts for weeks.** Long-running agents don't drown in context, and you can see and edit everything they remember.
- **Control from anywhere (later).** Telegram and Discord first, then the phone app through your own encrypted relay (or Tailscale).

## 2. Personas

| Persona | Needs |
|---|---|
| **The solo studio** (primary, the Beta 1 wedge; owner decision 2026-10-24): a creator or freelancer who runs a one-person studio | Projects that keep each client's brief, brand and references in one place; teammates that research, write copy and prepare drafts with that context; work on the files already on their PC; recurring deliverables (weekly reports, social posts) as workflows; approvals before anything leaves the machine |
| **The everyday power user**: installs apps, doesn't use a terminal | Install and go; agents that do real work (research, inbox, monitoring); "set it and forget it" routines; approvals as notifications; a clear audit trail |
| **The maker**: developer who self-hosts | Any model, everything visible, computers for code chores, headless mode on a home server, custom skills and plugins |
| **Tinkerer**: runs local models | Ollama support, custom MCP servers, editable skills and memory |

## 3. Glossary

- **Profile (teammate / bot):** an isolated agent identity. It has its own persona, model, tools/MCP, memory, skills, sandbox computer, channel tokens, routines and approval policy. In the UI it is called a *teammate*.
- **Run:** one execution of the agent loop, triggered by a message, a routine, the heartbeat, or another teammate.
- **Routine:** a scheduled or triggered task, defined by cron or natural language.
- **Heartbeat:** a cheap periodic wake-up that checks a `HEARTBEAT` checklist and either acts or stays quiet.
- **Node:** a place where a teammate's tools run: *This PC* (the owner's own computer, no Docker), a Docker *computer*, and later another PC, the paired phone, or a cloud machine. A teammate has at most one *workbench* node (shell, files, browser) and may be granted *capability* nodes (the phone's reminders and calendar).
- **Computer:** a Mawl sandbox container (Docker), one kind of node. Kind *terminal* (shell, files, headless browser) or *desktop* (adds a visible desktop and browser). A teammate has none, its own, or one shared with other teammates.
- **Folder grant:** a folder on This PC the owner lets a project or a teammate read (or read and write). File tools see nothing outside the grants.
- **Project:** shared context for a group of teammates: brief, guidelines and voice, brand kit, reference files, linked folders, threads, canvases and routines. Teammates outside the project see none of it.
- **Teammate request:** one teammate asking another to do a task (`ask_teammate`). The result comes back to the requester as data; approvals still go to the owner.
- **Workflow:** a routine whose body is a skill with inputs, plus its triggers and receipt, shown as a readable list of steps.
- **Webhook:** an address that starts one routine when another service calls it, with a signed request.
- **Skill:** a `SKILL.md` folder of instructions (and optional scripts) a teammate loads when a task needs it.
- **Plugin:** a bundle of skills, MCP servers, prompt blocks and routine templates.
- **Receipt:** a routine's definition of done, checked after each run.
- **Trace:** a compiled script from a successful routine run, replayed without the model except at its "holes".
- **Takeover:** the user takes an exclusive control lease on the computer.
- **Approval:** a pending action that needs a human decision under the policy.
- **Canvas:** a versioned front-end project (JSX, CSS, assets) a teammate writes and Mawl renders in a sandbox. Kinds: mockup, site, graphic, motion. See [CANVAS.md](CANVAS.md).
- **Channel:** a place you talk to Mawl: the desktop/web app, the mobile app, Telegram, or Discord.

## 4. Feature list (MoSCoW)

### Must (v1)
| ID | Feature | Notes |
|---|---|---|
| F1 | **Chat with a teammate** | Streaming responses; tool-activity cards (collapsible, human-readable, e.g. "Archived 26 newsletters"); attachments; markdown/code |
| F2 | **Multi-provider models** | Anthropic, OpenAI, OpenRouter, Ollama, plus any OpenAI-compatible endpoint. Each profile has a main model and a cheap "helper" model |
| F3 | **Profiles** | Create, clone, archive. Persona (`SOUL`), avatar color, model, tools, policy. Full isolation |
| F4 | **MCP connections** ("Connections" in the UI) | Using MCP servers is as easy as an app store: a featured shelf for everyday services (mail first, then calendar, files, notes, chat, tasks, design) with safe default policies, several accounts per service, and connect on demand when a teammate asks for a service mid-chat. Search the official MCP Registry and connect in one flow. Remote servers over HTTP with OAuth; stdio servers and `.mcpb` bundles on This PC (after the owner approves the exact command and version) or inside a computer. Per-profile enablement and per-tool policy. Many tools are deferred behind a tool search |
| F5 | **Built-in tools** | Shell, files, browser (Playwright MCP), desktop control (screenshot/act), web search/fetch, memory tools, `skill_load`, `tool_search`, `delegate` (subagent), `request_takeover`, `ask_user`, `notify`, schedule tools |
| F6 | **Background runs** | Runs keep going after the window closes. Queue, pause, resume, cancel. Message a teammate mid-run (steering). Activity feed |
| F7 | **Routines** | Cron, intervals, one-shot reminders, or natural language ("every weekday at 7, sweep my inbox"), always confirmed. Missed-run policy after sleep or shutdown. Receipts. Run history. Delivery channel per routine |
| F8 | **Heartbeat** | Optional per profile, default every 30 min. Checks a user-editable checklist. Stays silent unless something needs doing |
| F9 | **Memory system** | Pinned core blocks, episodic log, semantic facts, skills. Hybrid recall. Automatic compaction and handoff. **Fully viewable and editable in the UI.** See [MEMORY.md](MEMORY.md) |
| F10 | **Computers** | Optional, needs Docker Desktop. Create a terminal or desktop computer, or attach a teammate to an existing Mawl computer. Persistent home volume, auto-suspend, reset. The app detects Docker and guides the install |
| F11 | **Watch & take control** | Live desktop stream in the app. "Take control" / "Give back". The agent can ask for takeover (e.g. logins, 2FA, CAPTCHA). A secure credential form lets you type secrets into the sandbox without the model ever seeing them |
| F12 | **Approvals & policy** | Each action class gets a level: auto / ask / hand off / block. Defaults: sends, purchases, deletes and payments are ask. Approvals arrive on every channel |
| F14 | **Telegram & Discord** | Per-profile bot tokens over long polling (no inbound networking). Chat, approve, check status and run routines from the chat. Owner allowlist. Token locks |
| F15 | **Onboarding** | Windows installer, then three steps: provider (Continue with ChatGPT, an API key, Ollama, or the Claude plan) → name your first teammate → done. A computer is offered later. Mawl guides you |
| F16 | **Accent color & theme** | Light, dark or system theme. Six accent presets plus a custom color |
| F17 | **Activity & audit log** | Every tool call, approval, takeover and memory write is recorded and searchable |
| F18 | **Desktop host** | The app runs the server and its database itself: tray icon, starts at login, close-to-tray, Windows notifications. Headless mode (Docker or a plain process) serves the same web app |
| F19 | **Skills** | Agent Skills (`SKILL.md`) per teammate, loaded on demand, editable in the UI. Proposed skills wait in an approval queue |
| F20 | **This PC** *(added 2026-10-24)* | A teammate works on the owner's files in granted folders, with no Docker. Shell commands are `ask` by default, and the card shows the exact command; Mawl's own data and well-known secret folders are never reachable |
| F21 | **Projects** *(added 2026-10-24)* | Brief, guidelines and voice, reference library (uploads), linked folders, member teammates, threads; canvases, routines and a brand kit join later. The project's context reaches every member's prompt |
| F22 | **Teammate requests** *(added 2026-10-24)* | A teammate asks another to research, write or prepare something; the result returns to the requester. Depth and budget caps; visible request cards; approvals stay with the owner |

### Should (v1.x)
| ID | Feature |
|---|---|
| S1 | Group chats (2–6 teammates). Teammate requests are F22 |
| S2 | Sentinel: an independent guard model that reviews outbound actions before they run |
| S3 | Teach by demonstration: do a task in a browser Mawl controls and turn the recording into a draft workflow (PLAN D6.6) |
| S4 | Local plugin import (folder or zip): skills, MCP configs, prompt blocks, routine templates |
| S5 | Voice: speak to a teammate (STT/TTS with your own keys) |
| S6 | Remote access: an end-to-end encrypted relay the owner deploys to their own Cloudflare account; Tailscale for self-hosters |
| S7 | Cost and token dashboard per profile, with budgets and caps |
| S8 | **Trace compiler:** a routine run that passed its receipt becomes a script with model "holes", self-healing one broken step at a time |
| S9 | **Mobile app** (old F13): pair by QR code; chat, approvals, activity, watch/take control, push notifications; through the relay. The phone also offers tools: reminders, calendar, notifications, location, the share sheet |
| S10 | **Workflows and webhooks** *(added 2026-10-24)*: a routine built from a skill with inputs, shown as steps; signed webhooks that start one routine with its payload as data |
### Canvas (planned after D5, see [CANVAS.md](CANVAS.md))
| ID | Feature | Notes |
|---|---|---|
| C-F1 | **Canvas** | A teammate writes JSX and Mawl renders it live in a sandbox next to the chat: design mockups, front-end sites and graphics first, then animated motion graphics. Versioned, offline, exportable (HTML, PNG, Vite project zip; motion graphics and video later, through an optional Remotion engine the user installs from Settings) |
| C-F2 | **Canvases view** | A separate page that lists, searches, filters and manages every canvas across teammates: thumbnails, versions and restore, archive, export, delete |
| C-F3 | **Quality skill set** | Built-in skills (design direction, mockup, site, dataviz, motion, critique, copy) plus measurable review gates, so output is deliberate and not generic |

### Could (later)
Mawl Cloud (a hosted relay, an AI API gateway, cloud computers; parked while Mawl is a personal project, REDESIGN R21) · Mawl marketplace (plugins, skills) · Slack/WhatsApp/Email channels · WebRTC streaming (neko/Selkies) · remote sandbox providers (E2B, Daytona, SSH) · macOS and Linux desktop builds · multi-user households.

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
11. **Design a mockup.** *I ask a teammate for a landing page for my project.* (planned, after D5)
    - It writes a short design brief first, then builds the page, and the canvas opens beside the chat.
    - It checks its own result (contrast, overflow at phone width, placeholder text) and fixes failures before it says it is done.
    - I find the canvas later in Canvases, open an older version, and export it as a single HTML file.
12. **Work on my files.** *I grant a teammate my `Clients\Acme` folder and ask it to turn last month's notes into a report.* (planned, Beta 1)
    - It lists and reads files only inside that folder; a path outside it is refused.
    - Writing the report asks first, and a shell command shows me the exact command before it runs.
13. **Start a project.** *I create a project "Acme rebrand", paste the brief and voice guidelines, drop in five reference PDFs and add two teammates.* (planned, Beta 1)
    - Both teammates use the brief and voice without my repeating it, and can search the references.
    - A teammate that is not a member can't see the project's files.
14. **Teammates help each other.** *My writer teammate needs facts, so it asks my researcher teammate.* (planned, Beta 1)
    - A request card appears in both threads, and I can cancel it.
    - The research comes back to the writer, and anything that needs approval still asks me.

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
  - On This PC, file tools reach only granted folders (canonical paths, a fixed deny list including Mawl's own data). A shell is not confined by folder grants, so host shell commands are `ask` by default.
  - Webhooks are signed per hook, rate-limited, and their payloads are data, never instructions.
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
