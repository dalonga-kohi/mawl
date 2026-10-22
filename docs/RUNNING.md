# Running Mawl

Mawl runs as two containers: the server (which also serves the web app) and Postgres. This page gets you from a clone to a signed-in app. Compose v1 is for one person on one computer; the ports are bound to that computer's loopback address.

## What you need

- Docker with Compose v2 (Docker Desktop on Windows and macOS, Docker Engine plus the compose plugin on Linux).
- About 2 GB of free disk: the image holds the Claude Code binary (about 290 MB) and the web build.
- A free port 7420 (the app) and 1455 (Sign in with ChatGPT) on the computer.

## First start

All commands run from the repo root. The `docker compose` commands are the same in bash and PowerShell; only the password step differs.

1. Create `infra/compose/.env` with a random database password. One command per shell:

   ```bash
   # bash (macOS, Linux, Git Bash, WSL)
   printf 'MAWL_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > infra/compose/.env
   ```

   ```powershell
   # PowerShell 7 or Windows PowerShell 5.1: 48 hex characters, UTF-8 without a byte-order mark
   $pw = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLower(); [System.IO.File]::WriteAllText((Join-Path $PWD 'infra/compose/.env'), "MAWL_DB_PASSWORD=$pw`n", [System.Text.UTF8Encoding]::new($false))
   ```

   Hex keeps the password to letters and digits, which matters because it becomes part of a URL. `.env` is ignored by git, and compose refuses to start without the password.

   These commands overwrite an existing `.env`. If the database already exists, keep its old password (see Data and reset). To add optional settings, edit the file by hand; `infra/compose/.env.example` lists every setting.

2. Build and start:

   ```bash
   docker compose -f infra/compose/docker-compose.yml up -d --build
   ```

   The first build takes a few minutes. The server waits for the database, applies its migrations and then reports healthy.

3. Open http://localhost:7420. The `http://127.0.0.1:7420` address works too. The app asks for the owner token (next section).

Check the state with `docker compose -f infra/compose/docker-compose.yml ps`: both services should say `healthy`.

## The owner token

The server answers only requests that carry its owner token, so another web page or program on the computer cannot drive it. On the first start the server generates one, prints it once in its log, and keeps it in the secrets volume:

```bash
docker compose -f infra/compose/docker-compose.yml logs server     # shown once, on the first start
docker compose -f infra/compose/docker-compose.yml exec server cat /secrets/owner-token   # any time
```

Paste it into the "Enter your owner token" screen. The browser keeps it for that tab only, so a new tab or window asks again. To choose your own token instead, set `MAWL_OWNER_TOKEN` in `infra/compose/.env` (32 to 512 letters, digits, `-` or `_`; `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` makes one) and run `up -d` again. To get a new generated token, remove the file with `exec server rm /secrets/owner-token` and restart the server.

The token is a password for your Mawl: do not paste it into chats, issues or screenshots. The desktop app does not need it; it hands its own per-launch token to the window.

## Sign in with ChatGPT

Open Settings, then Models, and choose Sign in with ChatGPT. The page opens ChatGPT in your browser. After you approve, OpenAI sends the browser back to `http://127.0.0.1:1455/auth/callback`. Compose publishes that port on your computer's loopback address, so the redirect reaches the server in the container. If port 1455 is taken by another program, the sign-in cannot start.

## Sign in with a Claude plan (Claude Code)

Mawl never handles your Claude login. You sign in to the Claude Code binary inside the server container, and Mawl runs that binary:

```bash
docker compose -f infra/compose/docker-compose.yml exec server claude auth login
```

(From inside `infra/compose` you can drop the `-f` option.) The command prints a `https://claude.com/cai/oauth/authorize?...` link and then waits at `Paste code here if prompted >`. Open the link in any browser, sign in, copy the code the page shows and paste it into the terminal. No port needs to be open for this. The login is stored on the `mawl-claude` volume, so it survives restarts and rebuilds.

Check it with:

```bash
docker compose -f infra/compose/docker-compose.yml exec server claude auth status
```

Back in Settings, add a Claude Code provider. A signed-out binary shows as "not signed in". An API key or token in the environment is refused, because Mawl only uses the plan sign-in.

## Everyday commands

| Task | Command |
|---|---|
| Logs (follow) | `docker compose -f infra/compose/docker-compose.yml logs -f server` |
| Stop, keep data | `docker compose -f infra/compose/docker-compose.yml stop` |
| Start again | `docker compose -f infra/compose/docker-compose.yml start` |
| Stop and remove containers, keep data | `docker compose -f infra/compose/docker-compose.yml down` |
| Update after pulling new code | `docker compose -f infra/compose/docker-compose.yml up -d --build` |

The services restart by themselves after a reboot or a crash (`restart: unless-stopped`) as long as Docker is running.

## Settings

| Variable (`infra/compose/.env`) | Meaning |
|---|---|
| `MAWL_DB_PASSWORD` | Required. Password of the compose database. |
| `MAWL_ALLOWED_ORIGINS` | Optional. Extra browser origins, comma-separated, such as `https://mawl.example.com`. Without it only localhost and loopback addresses can open the app. |
| `MAWL_OWNER_TOKEN` | Optional. The owner token the app asks for. Empty: the server generates one into the secrets volume (see The owner token). |

Everything else the server reads is in [ARCHITECTURE.md](ARCHITECTURE.md) section 4.

## Data and reset

Three named volumes hold your state:

| Volume | Holds |
|---|---|
| `mawl_mawl-db` | The database: profiles, runs, memory, saved providers. |
| `mawl_mawl-secrets` | The master key that encrypts stored credentials, the ChatGPT host id and the generated owner token. |
| `mawl_mawl-claude` | The Claude Code login. |

Keep `mawl_mawl-secrets` together with `mawl_mawl-db`: the database cannot decrypt its credentials without that key.

To wipe everything and start from nothing, run `docker compose -f infra/compose/docker-compose.yml down -v`. This deletes all three volumes, and it cannot be undone. Then run the first-start steps again. If you change `MAWL_DB_PASSWORD` after the first start, the database keeps the old password, so a reset is the simple fix.

## Troubleshooting

- Port 7420 or 1455 is already in use (compose reports `ports are not available` or `address already in use`): stop the program that holds the port, then run `up -d` again. To find it, run `lsof -i :7420` in bash, or in PowerShell `Get-NetTCPConnection -LocalPort 7420,1455 -State Listen | Select-Object LocalPort, OwningProcess` and then `Get-Process -Id <OwningProcess>`. Do not move the ports in the compose file: the ChatGPT sign-in redirect only works on 1455.
- `set MAWL_DB_PASSWORD in infra/compose/.env`: step 1 was skipped, or the file is not in `infra/compose/`.
- The page does not load: run `docker compose -f infra/compose/docker-compose.yml ps` and `logs server`. A server that keeps restarting prints one `boot failed` line with the reason.
- "That token didn't work": copy the token again from `exec server cat /secrets/owner-token`, or from `MAWL_OWNER_TOKEN` if you set one. "Your saved token no longer works" means the server's token changed since this tab saved it.
- A provider check says Mawl does not check addresses on your private network: checking an unsaved provider refuses loopback and LAN addresses typed into the form (inside Docker, `host.docker.internal` is one), and every check refuses link-local and cloud metadata addresses. Save the provider, then use Check on it: a saved provider may use a private address. The default Ollama address always works.
- "Host not allowed" or a blocked WebSocket from another address: add that address to `MAWL_ALLOWED_ORIGINS`. Reaching the server from other computers is not supported yet, because there is no device sign-in (planned in P6.1).
