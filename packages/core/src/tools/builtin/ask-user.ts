import { z } from 'zod'
import { defineTool } from '../define.ts'
import { textRecord } from '../registry.ts'
import type { Tool, ToolResultRecord } from '../types.ts'

export const ASK_USER_TOOL = 'ask_user'
export const ASK_QUESTION_MAX = 1000
export const ASK_OPTIONS_MAX = 6
export const ASK_OPTION_MAX = 200

/**
 * `ask_user`: parks the run in `waiting_user` with the question. The worker is released; the reply
 * RPC records the answer as this call's result (`answerRecord`) and the run continues.
 */
export function askUserTool(): Tool {
  return defineTool({
    name: ASK_USER_TOOL,
    description:
      'Ask the owner a question and wait for the answer. Use it when you cannot go on without ' +
      'their decision or information. Ask one question at a time; options are suggestions, the ' +
      'owner may answer freely.',
    inputSchema: z.strictObject({
      question: z.string().trim().min(1).max(ASK_QUESTION_MAX),
      options: z
        .array(z.string().trim().min(1).max(ASK_OPTION_MAX))
        .min(1)
        .max(ASK_OPTIONS_MAX)
        .optional(),
    }),
    actionClass: 'owner_contact',
    run: async ({ question, options }) => ({
      kind: 'park',
      wait: { kind: 'question', payload: options ? { question, options } : { question } },
    }),
  })
}

/** The result the model gets for its `ask_user` call: the owner's answer, wrapped as data. */
export function answerRecord(answer: string): ToolResultRecord {
  return textRecord(ASK_USER_TOOL, answer)
}
