import { tool as sdkTool, type ToolSet } from 'ai'
import { delimitData } from '../prompts/assemble.ts'
import { allowAllGate } from './gate.ts'
import {
  ARTIFACT_PREVIEW_CHARS,
  ARTIFACT_THRESHOLD_TOKENS,
  EVENT_PREVIEW_CHARS,
  estimateTokens,
} from './tokens.ts'
import type {
  ArtifactStore,
  InvokeResult,
  RunTools,
  Tool,
  ToolCallRequest,
  ToolErrorCode,
  ToolGate,
  ToolRegistry,
  ToolResultRecord,
} from './types.ts'

/** The tag every tool result is wrapped in before the model sees it. */
export const TOOL_RESULT_TAG = 'tool_result'

export interface ToolRegistryOptions {
  tools: readonly Tool[]
  /** Default: allow everything (D2.3 replaces it with the policy engine). */
  gate?: ToolGate
  /** Where large outputs go. Without it they are truncated. */
  artifacts?: ArtifactStore
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** The model-facing record of a typed error. Exported so the host builds identical ones. */
export function errorRecord(
  toolName: string,
  code: ToolErrorCode,
  message: string,
): ToolResultRecord {
  return {
    toolName,
    output: {
      type: 'error-text',
      value: delimitData(TOOL_RESULT_TAG, `error ${code}: ${message}`),
    },
    isError: true,
    preview: clip(`error ${code}: ${message}`, EVENT_PREVIEW_CHARS),
    artifactId: null,
  }
}

/** The model-facing record of a plain text result (wrapped as data, Mawl's note outside). */
export function textRecord(toolName: string, text: string, note?: string): ToolResultRecord {
  const wrapped = delimitData(TOOL_RESULT_TAG, text)
  return {
    toolName,
    output: { type: 'text', value: note ? `${wrapped}\n${note}` : wrapped },
    isError: false,
    preview: clip(text, EVENT_PREVIEW_CHARS),
    artifactId: null,
  }
}

function toResult(call: ToolCallRequest, record: ToolResultRecord): InvokeResult {
  return {
    kind: 'result',
    record,
    part: {
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: record.output,
    },
  }
}

const joinNotes = (...notes: (string | undefined)[]) =>
  notes.filter((n): n is string => n !== undefined && n !== '').join('\n') || undefined

/**
 * Builds the tool registry. `forRun` binds it to one run and profile; its `invoke` is the single
 * choke point for tool calls: recorded result first (idempotency), then input validation, the
 * gate, the `run.tool_call` event, the tool, and the recorded, wrapped result.
 */
export function createToolRegistry(options: ToolRegistryOptions): ToolRegistry {
  const byName = new Map<string, Tool>()
  for (const t of options.tools) {
    if (byName.has(t.name)) throw new Error(`duplicate tool name: ${t.name}`)
    byName.set(t.name, t)
  }
  const gate = options.gate ?? allowAllGate
  const artifacts = options.artifacts
  const names = [...byName.keys()].sort()
  const toolSet: ToolSet = Object.fromEntries(
    names.map((name) => {
      const t = byName.get(name) as Tool
      return [name, sdkTool({ description: t.description, inputSchema: t.inputSchema })]
    }),
  )

  return {
    forRun({ runId, profileId }): RunTools {
      return {
        toolSet,
        names,
        async invoke(call, { ledger, signal, allowPark }) {
          const key = { stepIdx: call.stepIdx, toolCallId: call.toolCallId }
          const recorded = await ledger.toolResult(runId, key)
          if (recorded) return toResult(call, recorded)

          const save = async (
            record: ToolResultRecord,
            emit: Parameters<typeof ledger.recordToolResult>[3] = [],
          ) => toResult(call, await ledger.recordToolResult(runId, key, record, emit))

          const t = byName.get(call.toolName)
          if (!t) {
            return save(
              errorRecord(
                call.toolName,
                'unknown_tool',
                `There is no tool named "${clip(call.toolName, 80)}". Use only the tools offered.`,
              ),
            )
          }
          const prepared = t.prepare(call.input)
          if (!prepared.ok) {
            return save(
              errorRecord(
                t.name,
                'invalid_input',
                `The arguments do not match the tool's schema (${clip(prepared.issues, 500)}).`,
              ),
            )
          }

          const decision = await gate.check({
            runId,
            profileId,
            tool: t.name,
            actionClass: t.actionClass,
            argsRedacted: prepared.argsRedacted,
          })
          await ledger.recordToolCall(runId, {
            toolCallId: call.toolCallId,
            tool: t.name,
            argsRedacted: prepared.argsRedacted,
            actionClass: t.actionClass,
          })
          if (decision.decision === 'deny') {
            return save(
              errorRecord(
                t.name,
                'denied',
                `Policy denied this call: ${clip(decision.reason, 300)}`,
              ),
            )
          }

          let outcome: Awaited<ReturnType<typeof prepared.run>>
          try {
            outcome = await prepared.run({
              runId,
              profileId,
              stepIdx: call.stepIdx,
              toolCallId: call.toolCallId,
              signal,
            })
          } catch (err) {
            // Cancel, pause or shutdown: nothing is recorded, and the engine decides what happens.
            if (signal.aborted) throw err
            // Exception text can carry secrets or paths, so the model only learns that it failed.
            outcome = {
              kind: 'error',
              code: 'failed',
              message: 'The tool failed. Try another approach.',
            }
          }

          if (outcome.kind === 'park') {
            if (allowPark) return { kind: 'park', wait: outcome.wait }
            outcome = {
              kind: 'error',
              code: 'one_question_at_a_time',
              message: 'Ask one question at a time; this one was not sent.',
            }
          }
          if (outcome.kind === 'error') {
            return save(errorRecord(t.name, outcome.code, outcome.message))
          }

          const { text } = outcome
          const tokens = estimateTokens(text)
          if (tokens <= ARTIFACT_THRESHOLD_TOKENS) {
            return save(textRecord(t.name, text, outcome.note), outcome.emit ?? [])
          }
          const preview = text.slice(0, ARTIFACT_PREVIEW_CHARS)
          if (t.artifacts && artifacts) {
            const artifactId = await artifacts.create({
              profileId,
              runId,
              mime: 'text/plain',
              content: text,
              preview,
              tokenCount: tokens,
            })
            const note =
              `The full output (about ${tokens} tokens, ${text.length} characters) is saved as ` +
              `artifact ${artifactId}. This preview shows characters 0 to ${preview.length}. ` +
              `Call read_artifact with artifactId "${artifactId}" and an offset to read the rest.`
            return save(
              { ...textRecord(t.name, preview, joinNotes(note, outcome.note)), artifactId },
              outcome.emit ?? [],
            )
          }
          const note = `Output truncated to the first ${preview.length} of ${text.length} characters.`
          return save(
            textRecord(t.name, preview, joinNotes(note, outcome.note)),
            outcome.emit ?? [],
          )
        },
      }
    },
  }
}
