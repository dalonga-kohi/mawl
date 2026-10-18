import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import { ProviderFailureError } from '../failure.ts'
import { defaultClaudeQuery } from './default-query.ts'
import { buildClaudeEnv } from './env.ts'
import { failureForAssistantError, failureForRateLimit } from './errors.ts'
import { type ClaudeUsage, parseMessage, parseStreamEvent } from './messages.ts'
import { toClaudePrompt } from './prompt.ts'
import type { ClaudeQueryFn, ClaudeQueryHandle, ClaudeQueryOptions } from './types.ts'

export interface ClaudeCodeModelOptions {
  /** The model alias or id Claude Code understands, e.g. `sonnet`. */
  modelId: string
  /** Injected in tests; defaults to the SDK's `query`, loaded lazily. */
  query?: ClaudeQueryFn
  /** Faire's FAIRE_CLAUDE_CONFIG_DIR: where the owner's `claude auth login` keeps its login. */
  configDir?: string | undefined
  /** Faire's FAIRE_CLAUDE_CODE_PATH. Without it the SDK uses the binary it bundles. */
  pathToClaudeCodeExecutable?: string | undefined
  /**
   * Empty directory the binary runs in, created (recursively) if missing. Without it, one private
   * `mkdtemp` directory under the OS temp dir is created per process on first use and shared.
   */
  workDir?: string
  /** Environment source for the allowlist. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** Clock in ms, for turning a reset time into a wait. */
  now?: () => number
}

type Part = LanguageModelV4StreamPart

let defaultWorkDirPromise: Promise<string> | undefined

/**
 * One private directory per process, created on first use. `mkdtemp` picks an unpredictable name
 * and makes it owner-only (0o700 on POSIX), so another user or a planted symlink cannot take over
 * a fixed, shared path. Concurrent first calls share one promise; a failure is not kept.
 */
function defaultWorkDir(): Promise<string> {
  defaultWorkDirPromise ??= mkdtemp(join(tmpdir(), 'faire-claude-code-')).catch((err: unknown) => {
    defaultWorkDirPromise = undefined
    throw err
  })
  return defaultWorkDirPromise
}

const emptyUsage = (): LanguageModelV4Usage => ({
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
})

function mapUsage(usage: ClaudeUsage | undefined): LanguageModelV4Usage {
  if (!usage) return emptyUsage()
  const noCache = usage.input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  return {
    // Anthropic reports the cached parts outside input_tokens; the AI SDK total includes them.
    inputTokens: { total: noCache + cacheRead + cacheWrite, noCache, cacheRead, cacheWrite },
    outputTokens: { total: usage.output_tokens, text: undefined, reasoning: undefined },
    raw: {
      input_tokens: noCache,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    },
  }
}

function mapFinish(stopReason: string | null | undefined): LanguageModelV4FinishReason {
  const raw = stopReason ?? undefined
  switch (stopReason) {
    case undefined:
    case null:
    case 'end_turn':
    case 'stop_sequence':
      return { unified: 'stop', raw }
    case 'max_tokens':
      return { unified: 'length', raw }
    case 'refusal':
      return { unified: 'content-filter', raw }
    default:
      return { unified: 'other', raw }
  }
}

/**
 * A text-only AI SDK model over the unmodified Claude Code binary, signed in by the owner with
 * `claude auth login`. Faire never sees the login: it only spawns the binary with a clean
 * environment, no tools, no setting sources and no session.
 */
export function createClaudeCodeModel(opts: ClaudeCodeModelOptions): LanguageModelV4 {
  const query = opts.query ?? defaultClaudeQuery
  const now = opts.now ?? Date.now

  /** Validates the call, then starts the query. Everything unsupported fails before a spawn. */
  async function start(call: LanguageModelV4CallOptions) {
    if (call.tools && call.tools.length > 0) {
      throw new UnsupportedFunctionalityError({
        functionality: 'tools',
        message: 'The Claude plan provider runs text only for now.',
      })
    }
    const { system, prompt } = toClaudePrompt(call.prompt)
    let workDir: string
    if (opts.workDir) {
      workDir = opts.workDir
      await mkdir(workDir, { recursive: true })
    } else {
      workDir = await defaultWorkDir()
    }

    const controller = new AbortController()
    const { abortSignal } = call
    const onAbort = () => controller.abort(abortSignal?.reason)
    if (abortSignal?.aborted) onAbort()
    else abortSignal?.addEventListener('abort', onAbort, { once: true })

    const options: ClaudeQueryOptions = {
      model: opts.modelId,
      ...(system === undefined ? {} : { systemPrompt: system }),
      // No built-in tools, no settings, hooks or skills from disk, no MCP from config, no session.
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 1,
      includePartialMessages: true,
      // Anything not pre-approved is denied; with no tools there is nothing to ask about.
      permissionMode: 'dontAsk',
      abortController: controller,
      env: buildClaudeEnv({
        ...(opts.env ? { env: opts.env } : {}),
        configDir: opts.configDir,
      }),
      cwd: workDir,
      ...(opts.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: opts.pathToClaudeCodeExecutable }
        : {}),
    }
    const handle = query({ prompt, options })
    return {
      handle,
      controller,
      call,
      cleanup: () => abortSignal?.removeEventListener('abort', onAbort),
    }
  }

  type Started = Awaited<ReturnType<typeof start>>

  async function* run({ handle, controller, call, cleanup }: Started): AsyncGenerator<Part, void> {
    const open = new Map<number, { kind: 'text' | 'reasoning'; id: string }>()
    let sawPartial = false
    let metadataSent = false
    try {
      yield { type: 'stream-start', warnings: warningsFor(call) }
      try {
        for await (const raw of handle) {
          const message = parseMessage(raw)
          if (!message) continue

          if (message.type === 'stream_event') {
            const event = parseStreamEvent(message.event)
            if (!event) continue
            if (event.type === 'message_start') {
              if (!metadataSent) {
                metadataSent = true
                yield {
                  type: 'response-metadata',
                  ...(event.message.id ? { id: event.message.id } : {}),
                  ...(event.message.model ? { modelId: event.message.model } : {}),
                }
              }
            } else if (event.type === 'content_block_start') {
              const kind = event.content_block.type === 'thinking' ? 'reasoning' : 'text'
              if (event.content_block.type !== 'text' && kind === 'text') continue
              sawPartial = true
              const id = `${kind}-${event.index}`
              open.set(event.index, { kind, id })
              yield { type: `${kind}-start`, id }
            } else if (event.type === 'content_block_delta') {
              const block = open.get(event.index)
              if (!block) continue
              if (block.kind === 'text' && event.delta.type === 'text_delta' && event.delta.text) {
                yield { type: 'text-delta', id: block.id, delta: event.delta.text }
              } else if (
                block.kind === 'reasoning' &&
                event.delta.type === 'thinking_delta' &&
                event.delta.thinking
              ) {
                yield { type: 'reasoning-delta', id: block.id, delta: event.delta.thinking }
              }
            } else {
              const block = open.get(event.index)
              if (!block) continue
              open.delete(event.index)
              yield { type: `${block.kind}-end`, id: block.id }
            }
          } else if (message.type === 'assistant') {
            if (message.error) throw failureForAssistantError(message.error)
            // Only without partial events: otherwise the text was already streamed.
            if (!sawPartial) {
              for (const [i, block] of message.message.content.entries()) {
                if (block.type !== 'text' || !block.text) continue
                const id = `text-whole-${i}`
                yield { type: 'text-start', id }
                yield { type: 'text-delta', id, delta: block.text }
                yield { type: 'text-end', id }
              }
            }
          } else if (message.type === 'rate_limit_event') {
            if (message.rate_limit_info.status === 'rejected') {
              throw failureForRateLimit(message.rate_limit_info, now)
            }
          } else {
            if (message.subtype !== 'success' || message.is_error) {
              throw new ProviderFailureError('provider_error')
            }
            for (const block of open.values()) yield { type: `${block.kind}-end`, id: block.id }
            open.clear()
            yield {
              type: 'finish',
              usage: mapUsage(message.usage),
              finishReason: mapFinish(message.stop_reason),
            }
            return
          }
        }
      } catch (err) {
        if (err instanceof ProviderFailureError) throw err
        // An abort is the caller's doing and passes through as is. Anything else is the binary
        // failing (spawn, crash, closed pipe): its text can carry paths or tokens, so drop it.
        if (controller.signal.aborted) throw err
        throw new ProviderFailureError('provider_error')
      }
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new DOMException('aborted', 'AbortError')
      }
      // The binary ended without a result message.
      throw new ProviderFailureError('provider_error')
    } finally {
      cleanup()
      closeQuietly(handle)
    }
  }

  return {
    specificationVersion: 'v4',
    provider: 'anthropic-claude-code',
    modelId: opts.modelId,
    supportedUrls: {},

    async doStream(call) {
      const started = await start(call)
      const gen = run(started)
      const stream = new ReadableStream<Part>({
        async pull(c) {
          try {
            const next = await gen.next()
            if (next.done) c.close()
            else c.enqueue(next.value)
          } catch (err) {
            if (err instanceof ProviderFailureError) {
              c.enqueue({ type: 'error', error: err })
              c.enqueue({
                type: 'finish',
                usage: emptyUsage(),
                finishReason: { unified: 'error', raw: err.reason },
              })
              c.close()
            } else {
              c.error(err)
            }
          }
        },
        async cancel() {
          started.controller.abort()
          await gen.return(undefined)
        },
      })
      return { stream }
    },

    async doGenerate(call) {
      const started = await start(call)
      const content: LanguageModelV4Content[] = []
      const text = new Map<string, string>()
      const order: string[] = []
      let usage = emptyUsage()
      let finishReason: LanguageModelV4FinishReason = { unified: 'other', raw: undefined }
      let response: { id?: string; modelId?: string } = {}
      let warnings: Awaited<ReturnType<LanguageModelV4['doGenerate']>>['warnings'] = []
      for await (const part of run(started)) {
        switch (part.type) {
          case 'stream-start':
            warnings = part.warnings
            break
          case 'response-metadata':
            response = {
              ...(part.id ? { id: part.id } : {}),
              ...(part.modelId ? { modelId: part.modelId } : {}),
            }
            break
          case 'text-start':
          case 'reasoning-start':
            text.set(part.id, '')
            order.push(part.id)
            break
          case 'text-delta':
          case 'reasoning-delta':
            text.set(part.id, (text.get(part.id) ?? '') + part.delta)
            break
          case 'finish':
            usage = part.usage
            finishReason = part.finishReason
            break
        }
      }
      for (const id of order) {
        const value = text.get(id) ?? ''
        content.push(
          id.startsWith('reasoning')
            ? { type: 'reasoning', text: value }
            : { type: 'text', text: value },
        )
      }
      return { content, finishReason, usage, warnings, response }
    },
  }
}

function warningsFor(call: LanguageModelV4CallOptions) {
  // The binary takes no sampling settings.
  const ignored = [
    ['temperature', call.temperature],
    ['topP', call.topP],
    ['topK', call.topK],
    ['presencePenalty', call.presencePenalty],
    ['frequencyPenalty', call.frequencyPenalty],
    ['seed', call.seed],
    ['maxOutputTokens', call.maxOutputTokens],
    ['stopSequences', call.stopSequences?.length ? call.stopSequences : undefined],
  ] as const
  return ignored.flatMap(([feature, value]) =>
    value === undefined ? [] : [{ type: 'unsupported' as const, feature }],
  )
}

function closeQuietly(handle: ClaudeQueryHandle) {
  try {
    handle.close?.()
  } catch {
    // Closing a query that already ended can throw; nothing to do about it.
  }
}
