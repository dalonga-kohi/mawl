import { z } from 'zod'

/**
 * The SDK messages the adapter reads, checked loosely: the stream comes from a subprocess whose
 * shapes change between releases, so unknown messages and extra fields are ignored, never fatal.
 */
const StreamEvent = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('message_start'),
    message: z.looseObject({ id: z.string().optional(), model: z.string().optional() }),
  }),
  z.looseObject({
    type: z.literal('content_block_start'),
    index: z.number().int(),
    content_block: z.looseObject({ type: z.string() }),
  }),
  z.looseObject({
    type: z.literal('content_block_delta'),
    index: z.number().int(),
    delta: z.looseObject({
      type: z.string(),
      text: z.string().optional(),
      thinking: z.string().optional(),
    }),
  }),
  z.looseObject({ type: z.literal('content_block_stop'), index: z.number().int() }),
])
export type StreamEvent = z.infer<typeof StreamEvent>

const Usage = z.looseObject({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
})
export type ClaudeUsage = z.infer<typeof Usage>

const ClaudeMessage = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('stream_event'), event: z.unknown() }),
  z.looseObject({
    type: z.literal('assistant'),
    error: z.string().optional(),
    message: z.looseObject({
      id: z.string().optional(),
      model: z.string().optional(),
      content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
    }),
  }),
  z.looseObject({
    type: z.literal('rate_limit_event'),
    rate_limit_info: z.looseObject({
      status: z.string(),
      resetsAt: z.number().optional(),
    }),
  }),
  z.looseObject({
    type: z.literal('result'),
    subtype: z.string(),
    is_error: z.boolean().optional(),
    stop_reason: z.string().nullish(),
    usage: Usage.optional(),
  }),
])
export type ClaudeMessage = z.infer<typeof ClaudeMessage>

/** The message, or undefined for anything the adapter does not use or cannot read. */
export function parseMessage(raw: unknown): ClaudeMessage | undefined {
  const parsed = ClaudeMessage.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/** The stream event inside a `stream_event` message, or undefined when it is not one we use. */
export function parseStreamEvent(raw: unknown): StreamEvent | undefined {
  const parsed = StreamEvent.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}
