import { createHash } from 'node:crypto'
import { ChannelKind } from '@mawl/contracts'
import type { SystemModelMessage } from 'ai'
import { z } from 'zod'
import { BLOCKS } from './blocks.generated.ts'

/**
 * Prompt assembler (REDESIGN 5.2, MEMORY 7). A pure function: the same input always gives the
 * same output, and nothing here reads the clock.
 *
 * Layout, stable to volatile:
 *   1 identity, 2 rules, 3 tools (+ computer sub-block by kind), 4 persona (+ owner notes),
 *   5 skills-index, 6 memory-core, 7 environment.
 * The run engine adds the rest (segment preamble, recalled memories, summary, turns, input).
 *
 * Rule for optional blocks: empty input means the block is omitted, not rendered empty.
 * Tools, persona, skills and memory-core are omitted when their input is empty or blank; the
 * computer sub-block is omitted for kind `none` or no computer. Identity, rules and environment
 * are always present.
 *
 * Cache breakpoints sit after block 3 and after block 6. If the block a breakpoint belongs to
 * is omitted, it moves to the last present part before it. If both land on the same part, only
 * one breakpoint is set.
 */

const ComputerKindSchema = z.enum(['none', 'terminal', 'desktop'])
export type ComputerKind = z.infer<typeof ComputerKindSchema>

const oneLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\r\n]+$/, 'must be a single line')

const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return true
    } catch {
      return false
    }
  },
  { message: 'unknown IANA timezone' },
)

export const promptInputSchema = z.strictObject({
  /** Names of the tools offered this run. Empty: no tools block. */
  toolNames: z.array(oneLine(80)).default([]),
  /** The profile's persona text (personaMd). Untrusted data. */
  persona: z.string().default(''),
  /** The owner's personal context. Untrusted data. */
  ownerContext: z.string().default(''),
  /** Skills index: one line per skill. Order does not matter, the output is sorted by name. */
  skills: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
        description: oneLine(300),
      }),
    )
    .default([]),
  /** Pinned memory blocks, frozen for the segment. Rendered in the order given. */
  memoryCore: z
    .array(z.strictObject({ label: z.string().regex(/^[a-z0-9_-]{1,40}$/), text: z.string() }))
    .default([]),
  /**
   * The only volatile block. `now` is a UTC ISO timestamp supplied by the caller, and only the
   * calendar date in `tz` reaches the prompt (date, weekday, timezone, channel, computer kind
   * and state). The time of day is left out on purpose so the text is stable within a day.
   */
  environment: z.strictObject({
    now: z.iso.datetime(),
    tz: timezone,
    channel: z.union([z.literal('app'), ChannelKind]),
    computer: z
      .strictObject({
        kind: ComputerKindSchema,
        state: z
          .string()
          .regex(/^[a-z0-9 _.-]{1,40}$/i)
          .optional(),
      })
      .optional(),
  }),
})

export type PromptInput = z.input<typeof promptInputSchema>

export type PromptPartId =
  | 'identity'
  | 'rules'
  | 'tools'
  | 'computer-terminal'
  | 'computer-desktop'
  | 'persona'
  | 'skills-index'
  | 'memory-core'
  | 'environment'

export type PromptPart = {
  id: PromptPartId
  version: number
  text: string
  cacheBreakpoint: boolean
}

export type AssembledPrompt = {
  parts: PromptPart[]
  /** sha256 hex of the text of every part up to and including the last cache breakpoint. */
  prefixHash: string
}

/** Block 3 ends here, so the first breakpoint goes on the last present part of this set. */
const GROUP_THREE: readonly PromptPartId[] = [
  'identity',
  'rules',
  'tools',
  'computer-terminal',
  'computer-desktop',
]
const PART_SEPARATOR = '\n\n'

/**
 * Wraps untrusted text in `<tag>` delimiters. Any closing tag for `tag` inside the text is
 * broken with a backslash, so the data cannot end its own section early.
 */
export function delimitData(tag: string, text: string): string {
  const closer = new RegExp(`<\\s*/\\s*(${tag})`, 'gi')
  return `<${tag}>\n${text.trim().replace(closer, '<\\/$1')}\n</${tag}>`
}

function datePart(now: string, tz: string): { date: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).formatToParts(new Date(now))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday') }
}

function part(id: keyof typeof BLOCKS, text: string, version?: number): PromptPart {
  return { id, version: version ?? BLOCKS[id].version, text, cacheBreakpoint: false }
}

export function assemblePrompt(rawInput: PromptInput): AssembledPrompt {
  const input = promptInputSchema.parse(rawInput)
  const parts: PromptPart[] = [
    part('identity', BLOCKS.identity.text),
    part('rules', BLOCKS.rules.text),
  ]

  if (input.toolNames.length > 0) {
    const list = [...new Set(input.toolNames)].sort().join(', ')
    parts.push(part('tools', `${BLOCKS.tools.text}\n\nTools available: ${list}.`))
  }

  const kind = input.environment.computer?.kind ?? 'none'
  if (kind === 'terminal') parts.push(part('computer-terminal', BLOCKS['computer-terminal'].text))
  if (kind === 'desktop') parts.push(part('computer-desktop', BLOCKS['computer-desktop'].text))

  const persona = input.persona.trim()
  const notes = input.ownerContext.trim()
  if (persona !== '' || notes !== '') {
    const sections: string[] = [BLOCKS.persona.text]
    if (persona !== '') sections.push(delimitData('persona', persona))
    if (notes !== '') sections.push(delimitData('owner_notes', notes))
    parts.push(part('persona', sections.join(PART_SEPARATOR)))
  }

  if (input.skills.length > 0) {
    const lines = [...input.skills]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((s) => `- ${s.name}: ${s.description}`)
    parts.push(
      part(
        'skills-index',
        [BLOCKS['skills-index'].text, delimitData('skills', lines.join('\n'))].join(PART_SEPARATOR),
      ),
    )
  }

  const memory = input.memoryCore.filter((m) => m.text.trim() !== '')
  if (memory.length > 0) {
    const body = memory.map((m) => `[${m.label}]\n${m.text.trim()}`).join('\n\n')
    parts.push(
      part(
        'memory-core',
        [BLOCKS['memory-core'].text, delimitData('memory_core', body)].join(PART_SEPARATOR),
      ),
    )
  }

  parts.push(part('environment', environmentText(input.environment)))

  const lastGroupThree = lastIndexIn(parts, GROUP_THREE)
  const lastCore = parts.length - 2 // the part before environment
  for (const index of new Set([lastGroupThree, lastCore])) {
    const target = parts[index]
    if (target) target.cacheBreakpoint = true
  }

  const lastBreakpoint = parts.findLastIndex((p) => p.cacheBreakpoint)
  const prefix = parts
    .slice(0, lastBreakpoint + 1)
    .map((p) => p.text)
    .join(PART_SEPARATOR)
  return { parts, prefixHash: createHash('sha256').update(prefix).digest('hex') }
}

function lastIndexIn(parts: PromptPart[], ids: readonly PromptPartId[]): number {
  return parts.findLastIndex((p) => ids.includes(p.id))
}

function environmentText(env: z.output<typeof promptInputSchema>['environment']): string {
  const { date, weekday } = datePart(env.now, env.tz)
  const lines = [`Date: ${date} (${weekday})`, `Timezone: ${env.tz}`, `Channel: ${env.channel}`]
  const computer = env.computer
  if (computer && computer.kind !== 'none') {
    lines.push(`Computer: ${computer.kind}${computer.state ? `, ${computer.state}` : ''}`)
  } else {
    lines.push('Computer: none')
  }
  return `${BLOCKS.environment.text}\n\n${lines.join('\n')}`
}

/**
 * Turns parts into AI SDK system messages. Breakpoint parts carry Anthropic's ephemeral cache
 * control; other providers ignore the `anthropic` key.
 */
export function toSystemMessages(parts: readonly PromptPart[]): SystemModelMessage[] {
  return parts.map((p) =>
    p.cacheBreakpoint
      ? {
          role: 'system',
          content: p.text,
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        }
      : { role: 'system', content: p.text },
  )
}
