import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

type Service = {
  image?: string
  build?: { context: string; dockerfile: string }
  environment?: Record<string, string>
  ports?: string[]
  volumes?: string[]
  healthcheck?: { test: string[] }
  depends_on?: Record<string, { condition: string }>
  restart?: string
  init?: boolean
  stop_grace_period?: string
}
type Compose = { name: string; services: Record<string, Service>; volumes: Record<string, unknown> }

const compose = parse(read('infra/compose/docker-compose.yml')) as Compose
const db = compose.services.db as Service
const server = compose.services.server as Service

describe('infra/compose/docker-compose.yml', () => {
  it('is the faire project with exactly a db and a server service', () => {
    expect(compose.name).toBe('faire')
    expect(Object.keys(compose.services).sort()).toEqual(['db', 'server'])
  })

  it('publishes the server ports on the host loopback only, and the database on none', () => {
    expect(server.ports).toEqual(['127.0.0.1:7420:7420', '127.0.0.1:1455:1455'])
    for (const port of server.ports ?? []) expect(port).toMatch(/^127\.0\.0\.1:\d+:\d+$/)
    expect(db.ports).toBeUndefined()
  })

  it('keeps the database, secrets and Claude login on named volumes', () => {
    expect(Object.keys(compose.volumes).sort()).toEqual([
      'faire-claude',
      'faire-db',
      'faire-secrets',
    ])
    expect(db.volumes).toEqual(['faire-db:/var/lib/postgresql/data'])
    expect(server.volumes).toEqual(['faire-secrets:/secrets', 'faire-claude:/claude'])
  })

  it('requires FAIRE_DB_PASSWORD instead of defaulting it', () => {
    expect(db.environment?.POSTGRES_PASSWORD).toMatch(/^\$\{FAIRE_DB_PASSWORD:\?[^}]+\}$/)
    expect(server.environment?.DATABASE_URL).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: compose interpolation, not a JS template
      'postgres://faire:${FAIRE_DB_PASSWORD}@db:5432/faire',
    )
    // Nothing else may hold a password literal.
    expect(read('infra/compose/docker-compose.yml')).not.toMatch(/^\s*POSTGRES_PASSWORD:\s*[^$\s]/m)
  })

  it('starts the server only once the database healthcheck passes', () => {
    expect(db.healthcheck?.test.join(' ')).toContain('pg_isready')
    expect(server.depends_on).toEqual({ db: { condition: 'service_healthy' } })
  })

  it('pins the database image and builds the server from the repo root', () => {
    expect(db.image).toBe('pgvector/pgvector:0.8.7-pg17')
    expect(server.image).toBe('faire-server:local')
    expect(server.build).toEqual({ context: '../..', dockerfile: 'infra/docker/server.Dockerfile' })
  })

  it('restarts both services unless stopped and passes the allowed origins through', () => {
    expect(db.restart).toBe('unless-stopped')
    expect(server.restart).toBe('unless-stopped')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: compose interpolation, not a JS template
    expect(server.environment?.FAIRE_ALLOWED_ORIGINS).toBe('${FAIRE_ALLOWED_ORIGINS:-}')
  })
})

describe('server process lifecycle', () => {
  it('runs under an init process and gets 30 s to stop cleanly', () => {
    expect(server.init).toBe(true)
    expect(server.stop_grace_period).toBe('30s')
  })
})

describe('infra/compose/.env.example', () => {
  it('documents the required password without a value, and git ignores the real .env', () => {
    expect(read('infra/compose/.env.example')).toMatch(/^FAIRE_DB_PASSWORD=$/m)
    expect(read('.gitignore')).toMatch(/^infra\/compose\/\.env$/m)
  })
})

describe('infra/docker/server.Dockerfile', () => {
  const dockerfile = read('infra/docker/server.Dockerfile')

  it('pins every base image by digest', () => {
    const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1] as string)
    expect(froms.length).toBeGreaterThanOrEqual(2)
    for (const image of froms) expect(image).toMatch(/^[\w./:-]+@sha256:[0-9a-f]{64}$/)
  })

  it('runs as the node user with the runtime environment and healthcheck the compose file relies on', () => {
    expect(dockerfile).toMatch(/^USER node$/m)
    for (const env of [
      'FAIRE_HOST=0.0.0.0',
      'FAIRE_SECRETS_DIR=/secrets',
      'FAIRE_SIWC_BIND_HOST=0.0.0.0',
      'FAIRE_CLAUDE_CONFIG_DIR=/claude',
      'CLAUDE_CONFIG_DIR=/claude',
      'NODE_ENV=production',
    ]) {
      expect(dockerfile).toContain(env)
    }
    expect(dockerfile).toMatch(/^EXPOSE 7420 1455$/m)
    expect(dockerfile).toContain('HEALTHCHECK')
    expect(dockerfile).toContain('http://127.0.0.1:7420/healthz')
    expect(dockerfile).toMatch(/^CMD \["node", "\/app\/dist\/server\.mjs"\]$/m)
  })

  it('installs the SDK at the exact version the workspace pins, and links claude onto PATH', () => {
    const pinned = (
      JSON.parse(read('packages/core/package.json')) as {
        dependencies: Record<string, string>
      }
    ).dependencies['@anthropic-ai/claude-agent-sdk']
    expect(dockerfile).toContain(`@anthropic-ai/claude-agent-sdk@${pinned}`)
    expect(dockerfile).toContain('/usr/local/bin/claude')
  })

  it('keeps secrets and local state out of the build context', () => {
    const ignore = read('.dockerignore')
    for (const entry of ['.git', '.faire', '.env', '**/node_modules', '**/dist']) {
      expect(ignore).toMatch(new RegExp(`^${entry.replace(/[*.]/g, '\\$&')}$`, 'm'))
    }
  })
})
