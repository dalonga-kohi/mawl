# syntax=docker/dockerfile:1
# Faire server image: the esbuild bundle, its SQL migrations, the built web app, and the Claude
# Code native binary. Build context is the repository root:
#   docker build -f infra/docker/server.Dockerfile -t faire-server:local .
# Debian (glibc), not Alpine: the Claude Agent SDK ships a glibc binary per CPU architecture.

# ---- build: install the workspace, build the web app and the server bundle ----
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter @faire/server... --filter @faire/web...
RUN pnpm --filter @faire/web build && pnpm --filter @faire/server build

# ---- runtime: bundle + web + the Claude Code binary, as the non-root `node` user ----
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runtime
ENV NODE_ENV=production \
    FAIRE_HOST=0.0.0.0 \
    FAIRE_SECRETS_DIR=/secrets \
    FAIRE_SIWC_BIND_HOST=0.0.0.0 \
    FAIRE_CLAUDE_CONFIG_DIR=/claude \
    CLAUDE_CONFIG_DIR=/claude
WORKDIR /app

# The bundle keeps the Claude Agent SDK external (it finds its native binary beside itself), so
# install exactly that package for this image's architecture. npm picks the matching glibc
# `@anthropic-ai/claude-agent-sdk-linux-<arch>` binary package; `claude` on PATH is the same binary,
# which makes `docker compose exec server claude auth login` work.
RUN npm install --omit=dev --no-save --no-package-lock --no-audit --no-fund --ignore-scripts \
      @anthropic-ai/claude-agent-sdk@0.3.302 \
 && bin="$(find /app/node_modules/@anthropic-ai -maxdepth 2 -type f -name claude | head -n 1)" \
 && test -n "$bin" \
 && ln -s "$bin" /usr/local/bin/claude \
 && claude --version

COPY --from=build /repo/apps/server/dist/ /app/dist/
COPY --from=build /repo/apps/web/dist/ /app/dist/web/

# CLAUDE_CONFIG_DIR is for the shell: `docker compose exec server claude auth login` must write to the
# same directory the server hands to the binary it spawns (FAIRE_CLAUDE_CONFIG_DIR), and the volume.
# Named volumes copy this ownership when they are first created.
RUN mkdir -p /secrets /claude && chown node:node /secrets /claude
USER node

EXPOSE 7420 1455
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7420/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "/app/dist/server.mjs"]
