<div align="center">

# Mawl 🦫

**AI teammates you own.**

Self-hosted, always-on agents that run on your machine, with your keys and your choice of model.

![Status](https://img.shields.io/badge/status-in%20development-F5A623)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-pgvector-4169E1?logo=postgresql&logoColor=white)

</div>

---

## What it is

Mawl is a desktop app for running a small team of AI agents, called teammates. Each teammate has a persona, a model, a memory and, optionally, a computer of its own. Everything lives on your machine: the server, the database and the keys.

## Highlights

| | |
|---|---|
| 🧠 **Any model** | Anthropic, OpenAI, OpenRouter, or a local model through Ollama. Sign in with your ChatGPT or Claude plan, or use API keys. |
| 💾 **Memory that lasts** | Long-horizon memory you can read and edit, with automatic context management and prompt caching. |
| 🖥️ **A computer per teammate** | Optional sandboxed Docker computers, terminal or desktop. Watch one live and take over when you want. |
| ✅ **You stay in control** | A policy engine and approvals gate anything risky, and every action lands in an audit trail. |
| 📱 **Reach it from anywhere** | Desktop app first. Telegram, Discord and a mobile app are on the roadmap. |

## Status

Mawl is under active development. Built so far:

- Monorepo, shared contracts, design system and test tooling
- Server with a provider registry, ChatGPT sign-in and a durable run engine
- Web app: chat, tools, scheduled tasks, approvals, settings and a workspace panel
- Docker Compose stack for running it on one computer

In progress: the Windows desktop host with an embedded database, then the full agent loop, computers, the memory system and chat channels. The full list is in [docs/PLAN.md](docs/PLAN.md).

## Quick start

Needs Docker with Compose v2.

```bash
docker compose -f infra/compose/docker-compose.yml up -d --build
```

Set `MAWL_DB_PASSWORD` in `infra/compose/.env` first (copy `.env.example`), then open http://localhost:7420. [docs/RUNNING.md](docs/RUNNING.md) covers signing in, logs and reset.

## Repository layout

```
apps/
  server/      HTTP + WebSocket server, run engine, providers
  web/         React web app
  desktop/     Tauri 2 desktop host
  mobile/      Expo app (planned)
packages/
  contracts/   zod schemas, events and the oRPC contract
  core/        model providers and shared logic
  db/          Drizzle schema and migrations
  memory/      memory system
  sandbox/     computers
  ui/          design tokens and accent engine
infra/         Docker Compose and images
docs/          spec, architecture and design notes
```

## Docs

[Spec](docs/SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Memory](docs/MEMORY.md) · [Design](docs/DESIGN.md) · [Plan](docs/PLAN.md) · [Running](docs/RUNNING.md)

## Development

```bash
corepack pnpm i
pnpm lint
pnpm typecheck
pnpm test
```

Node 24 and pnpm 10. See [CLAUDE.md](CLAUDE.md) for the conventions and the agent workflow used to build the project.
