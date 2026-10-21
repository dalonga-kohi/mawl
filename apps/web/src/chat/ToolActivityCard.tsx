import type { Json, MessagePart } from '@mawl/contracts'
import { Check, ChevronDown, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useState } from 'react'
import { transitions } from '../motion/presets.ts'
import { cx } from '../ui/cx.ts'

type ToolCall = Extract<MessagePart, { type: 'tool_call' }>
type ToolResult = Extract<MessagePart, { type: 'tool_result' }>

export interface ToolStep {
  call: ToolCall
  result?: ToolResult
}

/** Pairs every tool call with its result (by `toolCallId`), keeping call order. */
export function pairToolSteps(parts: MessagePart[]): ToolStep[] {
  const results = new Map<string, ToolResult>()
  for (const p of parts) if (p.type === 'tool_result') results.set(p.toolCallId, p)
  return parts
    .filter((p): p is ToolCall => p.type === 'tool_call')
    .map((call) => {
      const result = results.get(call.toolCallId)
      return result ? { call, result } : { call }
    })
}

/** `web_fetch` → "web fetch"; MCP names (`mcp__server__tool`) read as "tool on server". */
export function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  const words = (s: string) => s.replace(/[_-]+/g, ' ').trim()
  return mcp ? `${words(mcp[2] ?? '')} on ${words(mcp[1] ?? '')}` : words(name)
}

export function toolSummary(steps: ToolStep[]): string {
  const failed = steps.filter((s) => s.result?.isError).length
  const running = steps.some((s) => !s.result)
  const first = steps[0] ? toolLabel(steps[0].call.tool) : 'a tool'
  if (steps.length === 1) {
    if (running) return `Using ${first}`
    return failed ? `${capital(first)} didn't work` : `Used ${first}`
  }
  if (running) return `Using ${steps.length} tools`
  return failed ? `Used ${steps.length} tools, ${failed} didn't work` : `Used ${steps.length} tools`
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function preview(value: Json): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

type StepStatus = 'running' | 'failed' | 'done'

function statusOf(steps: ToolStep[]): StepStatus {
  if (steps.some((s) => !s.result)) return 'running'
  return steps.some((s) => s.result?.isError) ? 'failed' : 'done'
}

/** Spinner while working, then a check (or an alert) that pops in with `spring.bouncy`. */
function StatusIcon({ status }: { status: StepStatus }) {
  return (
    <span
      className={cx(
        'grid size-6 shrink-0 place-items-center rounded-pill [&_svg]:size-3.5 [&_svg]:stroke-[2.4]',
        status === 'running'
          ? 'bg-accent-soft text-accent-ink'
          : status === 'failed'
            ? 'bg-warn-soft text-warn'
            : 'bg-ok-soft text-ok',
      )}
    >
      {status === 'running' ? (
        <span className="size-3 animate-spin rounded-pill border-2 border-current border-r-transparent" />
      ) : (
        <motion.span
          key="done"
          initial={{ scale: 0.6 }}
          animate={{ scale: 1, transition: transitions.bouncy }}
          className="grid place-items-center"
        >
          {status === 'failed' ? (
            <TriangleAlert aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
        </motion.span>
      )}
    </span>
  )
}

const codeBox =
  'max-h-40 overflow-auto rounded-sm px-3 py-2 font-mono text-micro whitespace-pre-wrap'

/**
 * DESIGN.md §9: one round pill that says what the teammate did with its tools; the steps,
 * arguments and results are one tap away in a card below it. A thin shimmer runs along the pill
 * while a tool is still working. Stored tool parts carry no timings, so no duration is shown.
 */
export function ToolActivity({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const status = statusOf(steps)
  const summary = toolSummary(steps)
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className={cx(
          'accent-tween relative flex h-9 max-w-full items-center gap-2 overflow-hidden rounded-pill bg-surface py-1 pr-3 pl-1.5 text-left',
          'text-small text-text-2 shadow-[0_0_0_1px_var(--line)] hover:bg-surface-2 hover:text-text active:scale-[.97] pointer-coarse:h-11',
        )}
      >
        <StatusIcon status={status} />
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className={cx(
            'size-4 shrink-0 transition-transform duration-(--dur-base) ease-out',
            open && 'rotate-180',
          )}
        />
        {status === 'running' ? (
          <span className="tool-shimmer absolute inset-x-4 bottom-0 h-px" aria-hidden="true" />
        ) : null}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: transitions.gentle }}
            exit={{ height: 0, opacity: 0, transition: transitions.exit }}
            className="w-full max-w-[60ch] overflow-hidden"
          >
            <ol className="flex flex-col gap-4 rounded-card bg-surface p-4 text-small text-text-2 shadow-[0_0_0_1px_var(--line)]">
              {steps.map((s) => (
                <li key={s.call.toolCallId} className="flex flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <StatusIcon status={statusOf([s])} />
                    <span className="font-semibold text-text">
                      {capital(toolLabel(s.call.tool))}
                    </span>
                  </span>
                  <pre className={cx(codeBox, 'bg-surface-2')}>{preview(s.call.args)}</pre>
                  {s.result ? (
                    <pre
                      className={cx(
                        codeBox,
                        s.result.isError ? 'bg-warn-soft text-warn' : 'bg-surface-2',
                      )}
                    >
                      {preview(s.result.result)}
                    </pre>
                  ) : (
                    <span className="pl-8">Working…</span>
                  )}
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
