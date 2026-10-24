import type { ActionClass, Json } from '@mawl/contracts'
import type { z } from 'zod'
import type { Tool, ToolContext, ToolOutcome } from './types.ts'

/** Strings longer than this are cut in the redacted arguments of the `run.tool_call` event. */
const REDACT_STRING_CHARS = 200

export interface ToolDefinition<S extends z.ZodType> {
  name: string
  description: string
  inputSchema: S
  actionClass: ActionClass
  /** Default true. False: the output never becomes an artifact (and is capped instead). */
  artifacts?: boolean
  /** Arguments as the `run.tool_call` event shows them. Default: the input with long strings cut. */
  redact?: (input: z.output<S>) => Json
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutcome>
}

function clip(value: Json): Json {
  if (typeof value === 'string') {
    return value.length > REDACT_STRING_CHARS ? `${value.slice(0, REDACT_STRING_CHARS)}…` : value
  }
  if (Array.isArray(value)) return value.map(clip)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]))
  }
  return value
}

/** Plain JSON copy (drops undefined), with long strings cut. */
export function defaultRedact(input: unknown): Json {
  const json = input === undefined ? null : (JSON.parse(JSON.stringify(input)) as Json)
  return clip(json)
}

/**
 * Registers a tool. The input is parsed here with the tool's schema, so `run` only ever sees a
 * valid argument and the registry needs no type erasure.
 */
export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): Tool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    actionClass: def.actionClass,
    artifacts: def.artifacts ?? true,
    prepare(raw) {
      const parsed = def.inputSchema.safeParse(raw)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
          .join('; ')
        return { ok: false, issues }
      }
      const input = parsed.data
      return {
        ok: true,
        argsRedacted: def.redact ? def.redact(input) : defaultRedact(input),
        run: (ctx) => def.run(input, ctx),
      }
    },
  }
}
