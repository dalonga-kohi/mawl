import type { Json, MessagePart } from '@faire/contracts'
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

function StatusIcon({ steps }: { steps: ToolStep[] }) {
  const running = steps.some((s) => !s.result)
  const failed = steps.some((s) => s.result?.isError)
  return (
    <span
      className={cx(
        'grid size-[26px] shrink-0 place-items-center rounded-[8px] [&_svg]:size-[15px] [&_svg]:stroke-[2.4]',
        running
          ? 'bg-accent-soft text-accent-ink'
          : failed
            ? 'bg-warn-soft text-warn'
            : 'bg-ok-soft text-ok',
      )}
    >
      {running ? (
        <span className="size-3.5 animate-spin rounded-pill border-2 border-current border-r-transparent" />
      ) : (
        <motion.span
          key="done"
          initial={{ scale: 0.6 }}
          animate={{ scale: 1, transition: transitions.bouncy }}
          className="grid place-items-center"
        >
          {failed ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
        </motion.span>
      )}
    </span>
  )
}

/**
 * DESIGN.md §9: one collapsed sentence about what the teammate did with its tools; the steps,
 * arguments and results are one tap away. A thin shimmer runs while a tool is still working.
 */
export function ToolActivityCard({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const running = steps.some((s) => !s.result)
  const summary = toolSummary(steps)
  return (
    <div className="max-w-[60ch] overflow-hidden rounded-md bg-surface shadow-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-[120ms] hover:bg-accent-softer focus-visible:outline-offset-[-2px]"
      >
        <StatusIcon steps={steps} />
        <span className="min-w-0 flex-1 truncate text-small font-semibold">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className={cx(
            'size-4 shrink-0 text-text-2 transition-transform duration-[200ms]',
            open && 'rotate-180',
          )}
        />
      </button>
      {running ? <div className="tool-shimmer h-0.5" aria-hidden="true" /> : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: transitions.gentle }}
            exit={{ height: 0, opacity: 0, transition: transitions.exit }}
            className="overflow-hidden"
          >
            <ol className="flex flex-col gap-3 px-3.5 pt-1 pb-3.5 pl-[50px] text-small text-text-2">
              {steps.map((s) => (
                <li key={s.call.toolCallId} className="flex flex-col gap-1.5">
                  <span className="font-semibold text-text">{capital(toolLabel(s.call.tool))}</span>
                  <pre className="max-h-40 overflow-auto rounded-xs bg-surface-2 px-2 py-1.5 font-mono text-micro whitespace-pre-wrap">
                    {preview(s.call.args)}
                  </pre>
                  {s.result ? (
                    <pre
                      className={cx(
                        'max-h-40 overflow-auto rounded-xs px-2 py-1.5 font-mono text-micro whitespace-pre-wrap',
                        s.result.isError ? 'bg-warn-soft text-warn' : 'bg-surface-2',
                      )}
                    >
                      {preview(s.result.result)}
                    </pre>
                  ) : (
                    <span>Working…</span>
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
