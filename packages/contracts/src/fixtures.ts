import type { z } from 'zod'
import type { ActionClass } from './enums'

/** Shared valid fixtures for contract tests. Not exported from the package. */
export const ULID = '01HZX3K9V2M4N6P8Q0R2S4T6V8'
export const id = (prefix: string) => `${prefix}_${ULID}`
export const TS = '2026-01-02T03:04:05.000Z'

export const profile = {
  id: id('prof'),
  name: 'Ada',
  slug: 'ada',
  color: '#3b82f6',
  personaMd: 'You are Ada.',
  modelMain: 'anthropic:claude-sonnet',
  modelHelper: null,
  heartbeatCron: null,
  createdAt: TS,
  archivedAt: null,
}

export const providerCredential = {
  id: id('cred'),
  provider: 'anthropic',
  label: 'Work key',
  baseUrl: null,
  accountEmail: null,
  planUsage: false,
  reauthRequired: false,
  createdAt: TS,
}

export const thread = {
  id: id('thr'),
  profileId: id('prof'),
  channel: 'app',
  peer: null,
  title: 'Hello',
  createdAt: TS,
  lastEventAt: TS,
}

export const message = {
  id: id('msg'),
  threadId: id('thr'),
  runId: id('run'),
  role: 'assistant',
  parts: [
    { type: 'text', text: 'hi' },
    { type: 'reasoning', text: 'thinking' },
    { type: 'tool_call', toolCallId: 'c1', tool: 'shell', args: { cmd: 'ls' } },
    { type: 'tool_result', toolCallId: 'c1', result: { ok: true }, isError: false },
    { type: 'file', artifactId: id('art'), mime: 'image/png', name: 'a.png' },
  ],
  tokenCount: 12,
  createdAt: TS,
}

export const run = {
  id: id('run'),
  profileId: id('prof'),
  threadId: id('thr'),
  trigger: 'user',
  status: 'running',
  budget: { maxTokens: 100000, maxSteps: 50 },
  usage: { inputTokens: 10, outputTokens: 5 },
  segmentNo: 0,
  startedAt: TS,
  endedAt: null,
  error: null,
}

export const runStep = {
  id: id('step'),
  runId: id('run'),
  idx: 0,
  kind: 'model',
  input: { prompt: 'x' },
  outputRef: null,
  usage: null,
  createdAt: TS,
}

export const artifact = {
  id: id('art'),
  profileId: id('prof'),
  runId: id('run'),
  mime: 'text/plain',
  sizeBytes: 10,
  preview: 'hello',
  tokenCount: 2,
}

export const approval = {
  id: id('appr'),
  runId: id('run'),
  tool: 'send_email',
  argsRedacted: { to: '[redacted]' },
  actionClass: 'send_message' satisfies z.infer<typeof ActionClass>,
  status: 'pending',
  decidedByDevice: null,
  decidedViaChannel: null,
  createdAt: TS,
  decidedAt: null,
}

export const routine = {
  id: id('rtn'),
  profileId: id('prof'),
  name: 'Morning brief',
  schedule: { kind: 'cron', expr: '0 8 * * *', timezone: 'Europe/Warsaw' },
  nlSource: 'every morning at 8',
  prompt: 'Brief me',
  deliveryChannel: 'telegram',
  enabled: true,
  lastRunId: null,
}

export const mcpServer = {
  id: id('mcp'),
  profileId: null,
  name: 'files',
  transport: 'stdio',
  enabled: true,
  toolPolicy: { read_file: 'auto' },
}

export const channelBinding = {
  id: id('chan'),
  profileId: id('prof'),
  kind: 'telegram',
  allowlist: ['12345'],
  status: 'connected',
}

export const device = {
  id: id('dev'),
  name: 'Laptop',
  pubkey: 'A'.repeat(43),
  platform: 'desktop',
  lastSeenAt: TS,
  revokedAt: null,
}

export const policyRule = {
  id: id('rule'),
  profileId: null,
  match: { actionClass: 'shell_exec' },
  level: 'ask',
}
