import type { Message, MessagePart } from '@mawl/contracts'
import { ChevronRight, Paperclip } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useState } from 'react'
import { enter, transitions } from '../motion/presets.ts'
import { cx } from '../ui/cx.ts'
import { Markdown } from './Markdown.tsx'
import { pairToolSteps, ToolActivity } from './ToolActivityCard.tsx'

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export const formatTime = (iso: string) => time.format(new Date(iso))

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tools'; parts: MessagePart[] }
  | { kind: 'file'; name: string }

/** Groups a message's parts into what the reader sees: text, a tool card per run of tool parts, files. */
export function toBlocks(parts: MessagePart[]): Block[] {
  const blocks: Block[] = []
  for (const part of parts) {
    const last = blocks.at(-1)
    switch (part.type) {
      case 'text':
        if (part.text.trim()) blocks.push({ kind: 'text', text: part.text })
        break
      case 'reasoning':
        if (part.text.trim()) blocks.push({ kind: 'reasoning', text: part.text })
        break
      case 'tool_call':
      case 'tool_result':
        if (last?.kind === 'tools') last.parts.push(part)
        else blocks.push({ kind: 'tools', parts: [part] })
        break
      case 'file':
        blocks.push({ kind: 'file', name: part.name ?? 'Attachment' })
        break
    }
  }
  return blocks
}

/** The plain text of a message (the owner's words are never rendered as markdown). */
export function userText(message: Message): string {
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

/** The model's reasoning, folded away behind one muted line. */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="-ml-2 flex h-8 w-fit items-center gap-1 rounded-md px-2 text-small text-text-2 transition-colors duration-(--dur-fast) hover:bg-hover hover:text-text pointer-coarse:h-11"
      >
        <ChevronRight
          aria-hidden="true"
          className={cx(
            'size-4 transition-transform duration-(--dur-base) ease-out',
            open && 'rotate-90',
          )}
        />
        Thinking
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: transitions.gentle }}
            exit={{ height: 0, opacity: 0, transition: transitions.exit }}
            className="overflow-hidden"
          >
            <p className="mt-1 ml-1 border-l-2 border-line pl-3.5 text-small whitespace-pre-wrap text-text-2">
              {text}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Blocks({ parts }: { parts: MessagePart[] }) {
  return toBlocks(parts).map((block, i) => {
    switch (block.kind) {
      case 'text':
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived in order and never reordered.
        return <Markdown key={i} text={block.text} />
      case 'reasoning':
        // biome-ignore lint/suspicious/noArrayIndexKey: as above.
        return <Reasoning key={i} text={block.text} />
      case 'tools':
        // biome-ignore lint/suspicious/noArrayIndexKey: as above.
        return <ToolActivity key={i} steps={pairToolSteps(block.parts)} />
      case 'file':
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            key={i}
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md bg-surface-2 px-3 text-micro text-text-2"
          >
            <Paperclip className="size-3.5" aria-hidden="true" />
            {block.name}
          </span>
        )
      default:
        return null
    }
  })
}

/**
 * The owner's words: a calm, tail-less 24 px bubble on `--surface-2`, aligned right
 * (DESIGN.md §9). The time shows on hover or focus with a mouse and always on touch.
 */
export function UserBubble({
  text,
  at,
  pending,
}: {
  text: string
  at?: string
  pending?: boolean
}) {
  return (
    <motion.div {...enter} className="group flex flex-col items-end gap-1 self-end">
      <div className="max-w-[min(56ch,85vw)] rounded-card bg-surface-2 px-4 py-2.5 break-words whitespace-pre-wrap">
        {text}
      </div>
      <span
        className={cx(
          'px-2 text-micro text-text-2 transition-opacity duration-(--dur-base)',
          !pending &&
            'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
        )}
      >
        {pending ? 'Sending…' : at ? formatTime(at) : null}
      </span>
    </motion.div>
  )
}

/** A stored message. Assistant replies are plain text on the background, 68ch wide. */
export function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') return <UserBubble text={userText(message)} at={message.createdAt} />
  if (message.role !== 'assistant') return null
  return (
    <motion.article
      {...enter}
      className="group flex max-w-[68ch] flex-col gap-3"
      aria-label="Reply"
    >
      <Blocks parts={message.parts} />
      <span className="text-micro text-text-2 opacity-0 transition-opacity duration-(--dur-base) group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
        {formatTime(message.createdAt)}
      </span>
    </motion.article>
  )
}
