import { mkdir, mkdtemp, stat } from 'node:fs/promises'
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
import type { ProviderFailureReason, ProviderTestResult } from '@faire/contracts'
import { ProviderFailureError } from '../failure.ts'
import { testClaudeCodeLogin } from './auth-status.ts'
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
  /**
   * The cheap `claude auth status` check run before the first query, so a login that is missing
   * or not a claude.ai subscription never reaches a billable call. Defaults to
   * `testClaudeCodeLogin` with this model's config dir, binary and env. Injected in tests.
   */
  checkLogin?: () => Promise<ProviderTestResult>
  /** Clock in ms, for turning a reset time into a wait and for the login check's cache. */
  now?: () => number
}

type Part = LanguageModelV4StreamPart

let defaultWorkDirPromise: Promise<string> | undefined

/** How long a passing login check is trusted before the binary is asked again. */
const LOGIN_CHECK_TTL_MS = 5 * 60_000

/** Passing checks by binary path and config dir, shared by every model made in this process. */
const loginOk = new Map<string, number>()
/** Checks under way, so concurrent first calls ask the binary once. */
const loginInFlight = new Map<string, Promise<ProviderTestResult>>()

/** Test-only: forget every cached and in-flight login check. */
export function __resetClaudeLoginCache(): void {
  loginOk.clear()
  loginInFlight.clear()
}

const LOGIN_FAILURE: Record<
  Extract<ProviderTestResult, { ok: false }>['reason'],
  ProviderFailureReason
> = {
  not_signed_in: 'reauth_required',
  wrong_auth_method: 'config_error',
  invalid_key: 'provider_error',
  unreachable: 'provider_error',
  rate_limited: 'provider_error',
  unexpected_response: 'provider_error',
}

/**
 * One private directory per process, created on first use. `mkdtemp` picks an unpredictable name
 * and makes it owner-only (0o700 on POSIX), so another user or a planted symlink cannot take over
 * a fixed, shared path. Concurrent first calls share one promise; a failure is not kept. The dir
 * is checked before each use and made again if it was removed.
 */
function defaultWorkDir(): Promise<string> {
  const previous = defaultWorkDirPromise
  const next: Promise<string> = (async () => {
    if (previous) {
      try {
        const dir = await previous
        // A tmp cleaner on a long-running server may have removed it: make a new one then.
        await stat(dir)
        return dir
      } catch (err) {
        // Only a vanished dir (or an earlier failed creation) is replaced; anything else is real.
        if (!isMissing(err) && !(await previousFailed(previous))) throw err
      }
    }
    return mkdtemp(join(tmpdir(), 'faire-claude-code-'))
  })()
  // Set synchronously so concurrent callers chain on this one attempt.
  defaultWorkDirPromise = next
  next.catch(() => {
    if (defaultWorkDirPromise === next) defaultWorkDirPromise = undefined
  })
  return next
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

const previousFailed = (p: Promise<string>) =>
  p.then(
    () => false,
    () => true,
  )

/**
 * Waits for `pending`, but rejects with the signal's reason (or an AbortError) if the caller
 * aborts first. `pending` itself is left running: other callers may share it and it never rejects.
 * A signal that is already aborted is not raced: the run then starts aborted, as before.
 */
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal || signal.aborted) return pending
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
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

  const checkLogin =
    opts.checkLogin ??
    (() =>
      testClaudeCodeLogin({
        configDir: opts.configDir,
        pathToClaudeCodeExecutable: opts.pathToClaudeCodeExecutable,
        ...(opts.env ? { env: opts.env } : {}),
      }))
  /** The binary and the config dir it will use, as `buildClaudeEnv` passes it on. */
  const loginKeyNow = () => {
    const configDir = buildClaudeEnv({
      ...(opts.env ? { env: opts.env } : {}),
      configDir: opts.configDir,
    }).CLAUDE_CONFIG_DIR
    return `${opts.pathToClaudeCodeExecutable ?? ''}\0${configDir ?? ''}`
  }

  /** Throws a ProviderFailureError unless the binary is signed in with a claude.ai subscription. */
  async function requireLogin(signal: AbortSignal | undefined): Promise<void> {
    const loginKey = loginKeyNow()
    const okAt = loginOk.get(loginKey)
    // Fresh only inside the window; a clock that stepped back is not trusted.
    const age = okAt === undefined ? undefined : now() - okAt
    if (age !== undefined && age >= 0 && age < LOGIN_CHECK_TTL_MS) return
    let pending = loginInFlight.get(loginKey)
    if (!pending) {
      // `then` also catches a check that throws before it returns a promise.
      pending = Promise.resolve()
        .then(checkLogin)
        .catch((): ProviderTestResult => ({ ok: false, reason: 'unreachable' }))
        .then((result) => {
          if (result.ok) loginOk.set(loginKey, now())
          return result
        })
        .finally(() => loginInFlight.delete(loginKey))
      loginInFlight.set(loginKey, pending)
    }
    const result = await untilAborted(pending, signal)
    if (!result.ok) throw new ProviderFailureError(LOGIN_FAILURE[result.reason])
  }

  /** Validates the call, then starts the query. Everything unsupported fails before a spawn. */
  async function start(call: LanguageModelV4CallOptions) {
    if (call.tools && call.tools.length > 0) {
      throw new UnsupportedFunctionalityError({
        functionality: 'tools',
        message: 'The Claude plan provider runs text only for now.',
      })
    }
    const { system, prompt } = toClaudePrompt(call.prompt)
    await requireLogin(call.abortSignal)
    let workDir: string
    try {
      if (opts.workDir) {
        workDir = opts.workDir
        await mkdir(workDir, { recursive: true })
      } else {
        workDir = await defaultWorkDir()
      }
    } catch {
      // The error text names the path. Drop it, as everywhere else in this adapter.
      throw new ProviderFailureError('provider_error')
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
    const cleanup = () => abortSignal?.removeEventListener('abort', onAbort)
    let handle: ClaudeQueryHandle
    try {
      handle = query({ prompt, options })
    } catch {
      // Nothing will run `cleanup` for a query that never started. The error text can carry
      // paths or tokens, so it is dropped, as in `run`.
      cleanup()
      throw new ProviderFailureError('provider_error')
    }
    return { handle, controller, call, cleanup }
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
      let started: Started
      try {
        started = await start(call)
      } catch (err) {
        // A failed login check is a provider failure like any other: report it in the stream.
        // Unsupported input and other errors still reject, as before.
        if (err instanceof ProviderFailureError) return { stream: failedStream(call, err) }
        throw err
      }
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

/** The parts a run emits when it fails before producing anything. */
function failedStream(call: LanguageModelV4CallOptions, err: ProviderFailureError) {
  return new ReadableStream<Part>({
    start(c) {
      c.enqueue({ type: 'stream-start', warnings: warningsFor(call) })
      c.enqueue({ type: 'error', error: err })
      c.enqueue({
        type: 'finish',
        usage: emptyUsage(),
        finishReason: { unified: 'error', raw: err.reason },
      })
      c.close()
    },
  })
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
