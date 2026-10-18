# Faire 🦫

**AI teammates you own.** They run on your machine, use your keys and your model, and keep working while you sleep.

Faire is a self-hosted, always-on agent app:
- **Any model.** Anthropic, OpenAI, OpenRouter, or a local model through Ollama.
- **A computer you can watch.** Each teammate has its own sandboxed Linux desktop. Watch it live and take control.
- **Memory that lasts.** Long-horizon memory you can see and edit, with automatic context management.
- **Control from anywhere.** Desktop (Tauri), phone (Expo, QR pairing), Telegram and Discord.
- **MCP connections, routines, a heartbeat, and approvals** for anything risky.

> Status: **planning**. No app code yet. See [docs/PLAN.md](docs/PLAN.md).

## Quick start

```bash
docker compose -f infra/compose/docker-compose.yml up -d --build
```

Set `FAIRE_DB_PASSWORD` in `infra/compose/.env` first (copy `.env.example`), then open http://localhost:7420. [docs/RUNNING.md](docs/RUNNING.md) covers sign-in with ChatGPT or Claude Code, logs and reset.

## Docs
- [Spec](docs/SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Memory](docs/MEMORY.md) · [Plan](docs/PLAN.md) · [Design](docs/DESIGN.md)
- Interactive mockup: [design/mockup/index.html](design/mockup/index.html)

## Working on Faire with Claude Code
See [CLAUDE.md](CLAUDE.md). The main session orchestrates, and the `explorer`, `coder`, `tester` and `reviewer` subagents (in `.claude/agents/`) implement each slice in a TDD loop.
