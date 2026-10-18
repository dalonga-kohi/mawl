import type { Message, MessagePart } from '@faire/contracts'
import { Paperclip } from 'lucide-react'
import { motion } from 'motion/react'
import { enter } from '../motion/presets.ts'
import { Markdown } from './Markdown.tsx'
import { pairToolSteps, ToolActivityCard } from './ToolActivityCard.tsx'

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

function Blocks({ parts }: { parts: MessagePart[] }) {
  return toBlocks(parts).map((block, i) => {
    switch (block.kind) {
      case 'text':
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived in order and never reordered.
        return <Markdown key={i} text={block.text} />
      case 'reasoning':
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <details key={i} className="group text-small text-text-2">
            <summary className="w-fit cursor-pointer rounded-xs font-semibold select-none hover:text-text">
              How it thought about this
            </summary>
            <p className="mt-1.5 border-l-2 border-line pl-3 whitespace-pre-wrap">{block.text}</p>
          </details>
        )
      case 'tools':
        // biome-ignore lint/suspicious/noArrayIndexKey: as above.
        return <ToolActivityCard key={i} steps={pairToolSteps(block.parts)} />
      case 'file':
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            key={i}
            className="inline-flex h-7 w-fit items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 text-micro text-text-2"
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

/** The owner's words: an accent-soft bubble on the right (DESIGN.md §9). */
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
    <motion.div {...enter} className="flex flex-col items-end gap-1 self-end">
      <div className="max-w-[min(52ch,85vw)] rounded-[var(--r-md)_var(--r-md)_6px_var(--r-md)] bg-accent-soft px-3.5 py-2.5 break-words whitespace-pre-wrap">
        {text}
      </div>
      <span className="text-micro text-text-2">
        {pending ? 'Sending…' : at ? formatTime(at) : null}
      </span>
    </motion.div>
  )
}

/** A stored message. Assistant replies are plain text on the background, full text width. */
export function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    return <UserBubble text={text} at={message.createdAt} />
  }
  if (message.role !== 'assistant') return null
  return (
    <motion.article {...enter} className="flex flex-col gap-2.5" aria-label="Reply">
      <Blocks parts={message.parts} />
      <span className="text-micro text-text-2">{formatTime(message.createdAt)}</span>
    </motion.article>
  )
}
