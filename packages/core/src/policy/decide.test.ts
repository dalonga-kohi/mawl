import type { ActionClass, PolicyLevel, PolicySource, RunTrigger } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import {
  decide,
  type PolicyConfig,
  type PolicyInput,
  type PolicyRuleLike,
  parseProfilePolicy,
} from './decide.ts'

const NONE: PolicyConfig = { userRules: [], profileRules: [], allowedHosts: [] }

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    tool: 'tool_x',
    actionClass: 'read',
    args: {},
    nodeKind: 'none',
    trigger: 'user',
    mode: 'standard',
    ...over,
  }
}

const user = (...userRules: PolicyRuleLike[]): PolicyConfig => ({ ...NONE, userRules })
const profile = (...profileRules: PolicyRuleLike[]): PolicyConfig => ({ ...NONE, profileRules })

type Row = [
  name: string,
  over: Partial<PolicyInput>,
  config: PolicyConfig,
  level: PolicyLevel,
  source: PolicySource,
]

const ALL_CLASSES: ActionClass[] = [
  'read',
  'write_local',
  'send_message',
  'purchase',
  'delete',
  'credential',
  'external_post',
  'shell_exec',
  'owner_contact',
]

describe('decide: global defaults per action class', () => {
  const expected: Record<ActionClass, PolicyLevel> = {
    read: 'auto',
    owner_contact: 'auto',
    write_local: 'ask',
    send_message: 'ask',
    external_post: 'ask',
    delete: 'ask',
    shell_exec: 'ask',
    credential: 'handoff',
    purchase: 'handoff',
  }
  it.each(ALL_CLASSES)('%s defaults to its level', (actionClass) => {
    const d = decide(input({ actionClass }), NONE)
    expect(d.level).toBe(expected[actionClass])
    expect(['global', 'floor']).toContain(d.source)
  })

  it.each(ALL_CLASSES)('%s on a Docker computer uses the same defaults', (actionClass) => {
    for (const nodeKind of ['docker_terminal', 'docker_desktop'] as const) {
      expect(decide(input({ actionClass, nodeKind }), NONE).level).toBe(expected[actionClass])
    }
  })
})

describe('decide: floors nothing can lower', () => {
  const lowering: PolicyLevel[] = ['auto', 'ask']
  const rows: Row[] = []
  for (const actionClass of ['credential', 'purchase'] as const) {
    for (const level of lowering) {
      rows.push([
        `user rule ${level} on ${actionClass}`,
        { actionClass },
        user({ match: { actionClass }, level }),
        'handoff',
        'floor',
      ])
      rows.push([
        `user rule ${level} on a ${actionClass} tool by name`,
        { actionClass, tool: 'pay' },
        user({ match: { tool: 'pay' }, level }),
        'handoff',
        'floor',
      ])
      rows.push([
        `profile rule ${level} on ${actionClass}`,
        { actionClass },
        profile({ match: { actionClass }, level }),
        'handoff',
        'floor',
      ])
    }
    rows.push([
      `Autopilot on ${actionClass}`,
      { actionClass, mode: 'autopilot' },
      NONE,
      'handoff',
      'global',
    ])
    rows.push([
      `a block rule on ${actionClass} stays block (stricter is fine)`,
      { actionClass },
      user({ match: { actionClass }, level: 'block' }),
      'block',
      'user_rule',
    ])
  }
  rows.push(
    [
      'user rule auto on delete',
      { actionClass: 'delete' },
      user({ match: { actionClass: 'delete' }, level: 'auto' }),
      'ask',
      'floor',
    ],
    [
      'user rule auto on a delete tool by name',
      { actionClass: 'delete', tool: 'rm' },
      user({ match: { tool: 'rm' }, level: 'auto' }),
      'ask',
      'floor',
    ],
    ['Autopilot on delete', { actionClass: 'delete', mode: 'autopilot' }, NONE, 'ask', 'global'],
    [
      'Autopilot on delete in a this_pc grant',
      { actionClass: 'delete', mode: 'autopilot', nodeKind: 'this_pc', grant: { inside: true } },
      NONE,
      'ask',
      'global',
    ],
    [
      'a delete block rule stays block',
      { actionClass: 'delete' },
      user({ match: { actionClass: 'delete' }, level: 'block' }),
      'block',
      'user_rule',
    ],
  )
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })
})

describe('decide: a teammate-triggered run never carries the owner approval (R19)', () => {
  const raised: ActionClass[] = ['write_local', 'send_message', 'external_post', 'shell_exec']
  const rows: Row[] = []
  for (const actionClass of raised) {
    rows.push([
      `user rule auto on ${actionClass}`,
      { actionClass, trigger: 'teammate' },
      user({ match: { actionClass }, level: 'auto' }),
      'ask',
      // A shell rule without a command prefix never lowers in the first place.
      actionClass === 'shell_exec' ? 'user_rule' : 'floor',
    ])
    rows.push([
      `Autopilot on ${actionClass}`,
      { actionClass, trigger: 'teammate', mode: 'autopilot' },
      NONE,
      'ask',
      'global',
    ])
  }
  rows.push(
    [
      'shell prefix rule auto',
      {
        actionClass: 'shell_exec',
        tool: 'shell',
        trigger: 'teammate',
        args: { command: 'git status' },
      },
      user({ match: { tool: 'shell', argPattern: 'git status' }, level: 'auto' }),
      'ask',
      'floor',
    ],
    [
      'this_pc write grant lowered to auto',
      {
        actionClass: 'write_local',
        trigger: 'teammate',
        nodeKind: 'this_pc',
        grant: { inside: true, writes: 'auto' },
      },
      NONE,
      'ask',
      'floor',
    ],
    ['read stays auto', { actionClass: 'read', trigger: 'teammate' }, NONE, 'auto', 'global'],
    [
      'owner_contact stays auto',
      { actionClass: 'owner_contact', trigger: 'teammate' },
      NONE,
      'auto',
      'global',
    ],
    [
      'a read rule to auto still applies',
      {
        actionClass: 'read',
        tool: 'web_fetch',
        trigger: 'teammate',
        args: { url: 'https://a.com/' },
      },
      user({ match: { tool: 'web_fetch' }, level: 'auto' }),
      'auto',
      'user_rule',
    ],
    [
      'web_fetch first host is not lifted by Autopilot',
      {
        tool: 'web_fetch',
        trigger: 'teammate',
        mode: 'autopilot',
        args: { url: 'https://a.com/' },
      },
      NONE,
      'ask',
      'global',
    ],
  )
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })

  it.each(['user', 'routine', 'heartbeat'] satisfies RunTrigger[])(
    'the %s trigger keeps the owner rule',
    (trigger) => {
      const d = decide(
        input({ actionClass: 'send_message', trigger }),
        user({ match: { actionClass: 'send_message' }, level: 'auto' }),
      )
      expect(d).toMatchObject({ level: 'auto', source: 'user_rule' })
    },
  )
})

describe('decide: web_fetch hosts', () => {
  const fetch = (url: string, over: Partial<PolicyInput> = {}) =>
    input({ tool: 'web_fetch', actionClass: 'read', args: { url }, ...over })
  const rows: Row[] = [
    ['first fetch to a host asks', fetch('https://a.com/x'), NONE, 'ask', 'global'],
    [
      'a host seen in this run is auto',
      fetch('https://a.com/y', { hostSeenInRun: true }),
      NONE,
      'auto',
      'global',
    ],
    [
      'an allow-listed host is auto',
      fetch('https://docs.example.com/p'),
      { ...NONE, allowedHosts: ['docs.example.com'] },
      'auto',
      'user_rule',
    ],
    [
      'allow list matches case-insensitively and with a trailing dot',
      fetch('https://DOCS.example.com./p'),
      { ...NONE, allowedHosts: ['Docs.Example.com'] },
      'auto',
      'user_rule',
    ],
    [
      'allow list matches an IDN host',
      fetch('https://xn--bcher-kva.de/'),
      { ...NONE, allowedHosts: ['bücher.de'] },
      'auto',
      'user_rule',
    ],
    [
      'allow list is exact: a subdomain still asks',
      fetch('https://evil.docs.example.com/'),
      { ...NONE, allowedHosts: ['docs.example.com'] },
      'ask',
      'global',
    ],
    [
      'allow list is exact: a suffix lookalike still asks',
      fetch('https://docs.example.com.evil.io/'),
      { ...NONE, allowedHosts: ['docs.example.com'] },
      'ask',
      'global',
    ],
    [
      'a port does not change the host',
      fetch('https://docs.example.com:8443/'),
      { ...NONE, allowedHosts: ['docs.example.com'] },
      'auto',
      'user_rule',
    ],
    [
      'Autopilot lifts the first-host ask',
      fetch('https://a.com/', { mode: 'autopilot' }),
      NONE,
      'auto',
      'autopilot',
    ],
    ['loopback is blocked', fetch('http://127.0.0.1/'), NONE, 'block', 'floor'],
    [
      'userinfo trick to loopback is blocked',
      fetch('http://user@evil.com@127.0.0.1/'),
      NONE,
      'block',
      'floor',
    ],
    [
      'credentials before a public host are blocked',
      fetch('http://user:pw@a.com/'),
      NONE,
      'block',
      'floor',
    ],
    ['IPv6 loopback is blocked', fetch('http://[::1]/'), NONE, 'block', 'floor'],
    ['hex-dotted loopback is blocked', fetch('http://0x7f.1/'), NONE, 'block', 'floor'],
    ['decimal loopback is blocked', fetch('http://2130706433/'), NONE, 'block', 'floor'],
    [
      'localhost with a trailing dot is blocked',
      fetch('http://localhost./'),
      NONE,
      'block',
      'floor',
    ],
    ['cloud metadata is blocked', fetch('http://169.254.169.254/latest/'), NONE, 'block', 'floor'],
    ['a LAN router name is blocked', fetch('http://router/'), NONE, 'block', 'floor'],
    ['a non-http scheme is blocked', fetch('file:///c:/x'), NONE, 'block', 'floor'],
    ['a missing url is blocked', input({ tool: 'web_fetch', args: {} }), NONE, 'block', 'floor'],
    [
      'a private host stays blocked even when allow-listed',
      fetch('http://printer.local/'),
      { ...NONE, allowedHosts: ['printer.local'] },
      'block',
      'floor',
    ],
    [
      'a private host stays blocked under Autopilot',
      fetch('http://10.0.0.1/', { mode: 'autopilot' }),
      NONE,
      'block',
      'floor',
    ],
    [
      'a private host stays blocked when seen',
      fetch('http://10.0.0.1/', { hostSeenInRun: true }),
      NONE,
      'block',
      'floor',
    ],
    [
      'a private host stays blocked against a user rule',
      fetch('http://127.0.0.1/'),
      user({ match: { tool: 'web_fetch' }, level: 'auto' }),
      'block',
      'floor',
    ],
    [
      'a class-level read auto rule keeps the first-host ask',
      fetch('https://a.com/'),
      user({ match: { actionClass: 'read' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a class-level read auto rule keeps the first-host ask in a teammate run',
      fetch('https://a.com/', { trigger: 'teammate' }),
      user({ match: { actionClass: 'read' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a node-kind-only auto rule keeps the first-host ask',
      fetch('https://a.com/'),
      user({ match: { nodeKind: 'docker_terminal' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a class-level read auto rule leaves a seen host auto',
      fetch('https://a.com/', { hostSeenInRun: true }),
      user({ match: { actionClass: 'read' }, level: 'auto' }),
      'auto',
      'user_rule',
    ],
    [
      'a class-level read block rule still blocks web_fetch',
      fetch('https://a.com/'),
      user({ match: { actionClass: 'read' }, level: 'block' }),
      'block',
      'user_rule',
    ],
    [
      'a url argPattern rule may lower web_fetch',
      fetch('https://a.com/x'),
      user({ match: { actionClass: 'read', argPattern: 'https://a.com/*' }, level: 'auto' }),
      'auto',
      'user_rule',
    ],
    [
      'a tool-named rule lowers web_fetch in a teammate run (read is not clamped)',
      fetch('https://a.com/', { trigger: 'teammate' }),
      user({ match: { tool: 'web_fetch' }, level: 'auto' }),
      'auto',
      'user_rule',
    ],
    [
      'a user rule can lower web_fetch for all public hosts',
      fetch('https://a.com/'),
      user({ match: { tool: 'web_fetch' }, level: 'auto' }),
      'auto',
      'user_rule',
    ],
    [
      'a user block rule beats the allow list',
      fetch('https://docs.example.com/'),
      {
        ...NONE,
        allowedHosts: ['docs.example.com'],
        userRules: [
          {
            match: { tool: 'web_fetch', argPattern: 'https://docs.example.com/*' },
            level: 'block',
          },
        ],
      },
      'block',
      'user_rule',
    ],
  ]
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })
})

describe('decide: this_pc (R16)', () => {
  const pc = (over: Partial<PolicyInput>) => input({ nodeKind: 'this_pc', ...over })
  const rows: Row[] = [
    [
      'a read inside a grant is auto',
      pc({ actionClass: 'read', grant: { inside: true } }),
      NONE,
      'auto',
      'global',
    ],
    [
      'a read outside a grant is blocked',
      pc({ actionClass: 'read', grant: { inside: false } }),
      NONE,
      'block',
      'floor',
    ],
    [
      'a read without grant information is blocked (fail closed)',
      pc({ actionClass: 'read' }),
      NONE,
      'block',
      'floor',
    ],
    [
      'a write inside a grant asks',
      pc({ actionClass: 'write_local', grant: { inside: true } }),
      NONE,
      'ask',
      'global',
    ],
    [
      'a write in a grant that allows writes is auto',
      pc({ actionClass: 'write_local', grant: { inside: true, writes: 'auto' } }),
      NONE,
      'auto',
      'user_rule',
    ],
    [
      'a write outside a grant is blocked',
      pc({ actionClass: 'write_local', grant: { inside: false } }),
      NONE,
      'block',
      'floor',
    ],
    [
      'a write outside a grant stays blocked against a user rule',
      pc({ actionClass: 'write_local', grant: { inside: false } }),
      user({ match: { actionClass: 'write_local' }, level: 'auto' }),
      'block',
      'floor',
    ],
    [
      'a write outside a grant stays blocked under Autopilot',
      pc({ actionClass: 'write_local', mode: 'autopilot' }),
      NONE,
      'block',
      'floor',
    ],
    [
      'Autopilot lifts a write inside a grant',
      pc({ actionClass: 'write_local', grant: { inside: true }, mode: 'autopilot' }),
      NONE,
      'auto',
      'autopilot',
    ],
    [
      'a delete inside a grant asks',
      pc({ actionClass: 'delete', grant: { inside: true } }),
      NONE,
      'ask',
      'global',
    ],
    [
      'a delete in an auto-write grant still asks',
      pc({ actionClass: 'delete', grant: { inside: true, writes: 'auto' } }),
      NONE,
      'ask',
      'global',
    ],
    ['a delete outside a grant is blocked', pc({ actionClass: 'delete' }), NONE, 'block', 'floor'],
    [
      'shell asks, with or without a grant',
      pc({ actionClass: 'shell_exec', tool: 'shell', args: { command: 'ls' } }),
      NONE,
      'ask',
      'global',
    ],
    [
      'Autopilot lifts shell',
      pc({ actionClass: 'shell_exec', tool: 'shell', args: { command: 'ls' }, mode: 'autopilot' }),
      NONE,
      'auto',
      'autopilot',
    ],
    [
      'a node-kind rule applies on this_pc',
      pc({ actionClass: 'write_local', grant: { inside: true } }),
      user({ match: { actionClass: 'write_local', nodeKind: 'this_pc' }, level: 'block' }),
      'block',
      'user_rule',
    ],
    [
      'a node-kind rule for Docker does not apply on this_pc',
      pc({ actionClass: 'write_local', grant: { inside: true } }),
      user({ match: { actionClass: 'write_local', nodeKind: 'docker_terminal' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a this_pc rule does not apply without a node',
      input({ actionClass: 'send_message' }),
      user({ match: { actionClass: 'send_message', nodeKind: 'this_pc' }, level: 'auto' }),
      'ask',
      'global',
    ],
  ]
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })
})

describe('decide: shell_exec is lowered only by an exact command-prefix rule', () => {
  const sh = (command: string, over: Partial<PolicyInput> = {}) =>
    input({
      tool: 'shell',
      actionClass: 'shell_exec',
      nodeKind: 'this_pc',
      args: { command },
      ...over,
    })
  const gitStatus = user({ match: { tool: 'shell', argPattern: 'git status' }, level: 'auto' })
  const rows: Row[] = [
    ['the exact command', sh('git status'), gitStatus, 'auto', 'user_rule'],
    ['the command with arguments', sh('git status --short'), gitStatus, 'auto', 'user_rule'],
    ['not a longer word', sh('git statusx'), gitStatus, 'ask', 'global'],
    ['not a chained command', sh('git status; rm -rf C:\\'), gitStatus, 'ask', 'global'],
    ['not an and-chain', sh('git status && del x'), gitStatus, 'ask', 'global'],
    ['not a pipe', sh('git status | Out-File x'), gitStatus, 'ask', 'global'],
    ['not a newline', sh('git status\nRemove-Item x'), gitStatus, 'ask', 'global'],
    ['not a subexpression', sh('git status $(Remove-Item x)'), gitStatus, 'ask', 'global'],
    [
      'an action-class rule without a prefix does not lower',
      sh('git status'),
      user({ match: { actionClass: 'shell_exec' }, level: 'auto' }),
      'ask',
      'user_rule',
    ],
    [
      'a tool rule without a prefix does not lower',
      sh('ls'),
      user({ match: { tool: 'shell' }, level: 'auto' }),
      'ask',
      'user_rule',
    ],
    [
      'a glob-looking prefix never matches',
      sh('git push'),
      user({ match: { tool: 'shell', argPattern: 'git *' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a prefix block rule raises',
      sh('git push origin'),
      user({ match: { tool: 'shell', argPattern: 'git push' }, level: 'block' }),
      'block',
      'user_rule',
    ],
    [
      'works on a Docker computer too',
      sh('git status', { nodeKind: 'docker_terminal' }),
      gitStatus,
      'auto',
      'user_rule',
    ],
  ]
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })
})

describe('decide: MCP tools', () => {
  const mcp = (over: Partial<PolicyInput> = {}) =>
    input({ tool: 'mcp__mail__list', mcpServer: 'mail', actionClass: 'read', ...over })
  const rows: Row[] = [
    ['an MCP tool asks by default', mcp(), NONE, 'ask', 'global'],
    [
      'a read-only hint lowers a read tool to auto',
      mcp({ readOnlyHint: true }),
      NONE,
      'auto',
      'global',
    ],
    [
      'a read-only hint on a non-read class is ignored',
      mcp({ readOnlyHint: true, actionClass: 'send_message' }),
      NONE,
      'ask',
      'global',
    ],
    [
      'a read-only hint never lowers a credential tool',
      mcp({ readOnlyHint: true, actionClass: 'credential' }),
      NONE,
      'handoff',
      'floor',
    ],
    [
      'a server rule applies',
      mcp(),
      user({ match: { mcpServer: 'mail' }, level: 'auto' }),
      'auto',
      'user_rule',
    ],
    [
      'a server rule does not apply to another server',
      mcp({ mcpServer: 'files', tool: 'mcp__files__list' }),
      user({ match: { mcpServer: 'mail' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a tool rule beats a server rule',
      mcp(),
      user(
        { match: { mcpServer: 'mail' }, level: 'auto' },
        { match: { tool: 'mcp__mail__list' }, level: 'block' },
      ),
      'block',
      'user_rule',
    ],
    ['Autopilot lifts the MCP ask', mcp({ mode: 'autopilot' }), NONE, 'auto', 'autopilot'],
  ]
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })
})

describe('decide: precedence', () => {
  const send = input({ tool: 'send_mail', actionClass: 'send_message' })
  const rows: Row[] = [
    [
      'user rule beats profile rule',
      send,
      {
        ...NONE,
        userRules: [{ match: { actionClass: 'send_message' }, level: 'auto' }],
        profileRules: [{ match: { tool: 'send_mail' }, level: 'block' }],
      },
      'auto',
      'user_rule',
    ],
    [
      'profile rule beats the global default',
      send,
      profile({ match: { actionClass: 'send_message' }, level: 'auto' }),
      'auto',
      'profile',
    ],
    [
      'exact tool beats action class in a tier',
      send,
      user(
        { match: { actionClass: 'send_message' }, level: 'block' },
        { match: { tool: 'send_mail' }, level: 'auto' },
      ),
      'auto',
      'user_rule',
    ],
    [
      'a tie goes to the stricter rule (block over ask)',
      send,
      user(
        { match: { tool: 'send_mail' }, level: 'ask' },
        { match: { tool: 'send_mail' }, level: 'block' },
      ),
      'block',
      'user_rule',
    ],
    [
      'a tie goes to the stricter rule (handoff over auto)',
      send,
      user(
        { match: { tool: 'send_mail' }, level: 'auto' },
        { match: { tool: 'send_mail' }, level: 'handoff' },
      ),
      'handoff',
      'user_rule',
    ],
    [
      'a tie goes to the stricter rule regardless of order',
      send,
      user(
        { match: { tool: 'send_mail' }, level: 'block' },
        { match: { tool: 'send_mail' }, level: 'auto' },
      ),
      'block',
      'user_rule',
    ],
    [
      'a qualified rule beats an unqualified one of the same rank',
      input({ tool: 'write', actionClass: 'write_local', args: { path: 'notes/a.md' } }),
      user(
        { match: { tool: 'write' }, level: 'block' },
        { match: { tool: 'write', argPattern: 'notes/*' }, level: 'auto' },
      ),
      'auto',
      'user_rule',
    ],
    [
      'an argPattern that does not match leaves the rule out',
      input({ tool: 'write', actionClass: 'write_local', args: { path: 'secret/a' } }),
      user({ match: { tool: 'write', argPattern: 'notes/*' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'an argPattern never matches a tool without a primary argument',
      input({ tool: 'write', actionClass: 'write_local', args: { n: 1 } }),
      user({ match: { tool: 'write', argPattern: '*' }, level: 'auto' }),
      'ask',
      'global',
    ],
    [
      'a rule can raise a read',
      input({ tool: 'web_search' }),
      user({ match: { tool: 'web_search' }, level: 'block' }),
      'block',
      'user_rule',
    ],
    [
      'Autopilot does not lift an owner-written ask',
      { ...send, mode: 'autopilot' },
      user({ match: { tool: 'send_mail' }, level: 'ask' }),
      'ask',
      'user_rule',
    ],
    ['Autopilot lifts a default ask', { ...send, mode: 'autopilot' }, NONE, 'auto', 'autopilot'],
    [
      'Autopilot lifts a profile ask',
      { ...send, mode: 'autopilot' },
      profile({ match: { tool: 'send_mail' }, level: 'ask' }),
      'auto',
      'autopilot',
    ],
    [
      'Autopilot never lifts block',
      { ...send, mode: 'autopilot' },
      user({ match: { tool: 'send_mail' }, level: 'block' }),
      'block',
      'user_rule',
    ],
    [
      'an unrelated tool rule is ignored',
      send,
      user({ match: { tool: 'other' }, level: 'auto' }),
      'ask',
      'global',
    ],
  ]
  it.each(rows)('%s', (_name, over, config, level, source) => {
    expect(decide(input(over), config)).toMatchObject({ level, source })
  })

  it.each([
    ['https://*.example.com/*', 'https://evil.net/?.example.com/', false],
    ['https://*.example.com/*', 'https://evil.net/x.example.com/', false],
    ['https://*.example.com/*', 'https://evil.net#.example.com/', false],
    ['https://*.example.com/*', 'https://a.example.com/x', true],
    ['https://*.example.com/*', 'https://a.example.com/x?q=1', true],
    ['https://*.example.com/*', 'https://example.com.evil.net/', false],
    ['https://*example.com/*', 'https://user@evil.net/?example.com/', false],
    ['https://example.com', 'https://example.com', true],
    ['https://example.com', 'https://example.com/other', false],
    ['*.example.com/*', 'https://a.example.com/x', false],
    ['https://*', 'https://evil.net/x', false],
  ])('url glob %s against %s is %s (a star never crosses the host)', (pattern, url, lowers) => {
    const d = decide(
      input({ tool: 'fetch_like', actionClass: 'send_message', args: { url } }),
      user({ match: { tool: 'fetch_like', argPattern: pattern }, level: 'auto' }),
    )
    expect(d.level).toBe(lowers ? 'auto' : 'ask')
  })

  it('a url subject over 2048 characters never matches a glob, so it never lowers', () => {
    const url = `https://a.com/${'x'.repeat(2100)}`
    const d = decide(
      input({ tool: 'fetch_like', actionClass: 'send_message', args: { url } }),
      user({ match: { tool: 'fetch_like', argPattern: 'https://a.com/*' }, level: 'auto' }),
    )
    expect(d).toMatchObject({ level: 'ask', source: 'global' })
  })

  it('a 5000-character url against 200 rules stays fast and does not lower', () => {
    const url = `https://a.com/${'a'.repeat(5000)}`
    const rules = Array.from({ length: 200 }, () => ({
      match: { tool: 'fetch_like', argPattern: `${'*a'.repeat(50)}b` },
      level: 'auto' as const,
    }))
    const start = performance.now()
    const d = decide(
      input({ tool: 'fetch_like', actionClass: 'send_message', args: { url } }),
      user(...rules),
    )
    expect(d.level).toBe('ask')
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('always explains itself', () => {
    expect(decide(input({ actionClass: 'credential' }), NONE).reason).toMatch(/\S/)
  })
})

describe('parseProfilePolicy', () => {
  it('reads a valid policy', () => {
    const r = parseProfilePolicy({ mode: 'autopilot', allowedHosts: ['a.com'] })
    expect(r.valid).toBe(true)
    expect(r.policy).toEqual({ mode: 'autopilot', rules: [], allowedHosts: ['a.com'] })
  })

  it('reads {} as the default policy', () => {
    expect(parseProfilePolicy({})).toEqual({
      valid: true,
      policy: { mode: 'standard', rules: [], allowedHosts: [] },
    })
  })

  it.each([
    ['null', null],
    ['a string', 'autopilot'],
    ['an unknown mode', { mode: 'yolo' }],
    ['an unknown key', { allowAll: true }],
    [
      'a credential rule below handoff',
      { rules: [{ match: { actionClass: 'credential' }, level: 'auto' }] },
    ],
    ['an array', []],
  ])('falls back to the default policy (never Autopilot) on %s', (_name, raw) => {
    expect(parseProfilePolicy(raw)).toEqual({
      valid: false,
      policy: { mode: 'standard', rules: [], allowedHosts: [] },
    })
  })
})
