import { z } from 'zod'
import { defineTool } from '../define.ts'
import type { Tool } from '../types.ts'

export const NOTIFY_TITLE_MAX = 120
export const NOTIFY_BODY_MAX = 1000

/**
 * `notify`: tells the owner something without stopping the run. It emits a `notify` event (the
 * desktop host can show it as an OS toast; headless only stores it). The event is committed with
 * the recorded result, so a resumed run never notifies twice.
 */
export function notifyTool(): Tool {
  return defineTool({
    name: 'notify',
    description:
      'Send the owner a short notification (for example when a long task is done or needs their ' +
      'attention later). The run continues; use ask_user instead when you need an answer.',
    inputSchema: z.strictObject({
      title: z.string().trim().min(1).max(NOTIFY_TITLE_MAX),
      body: z.string().trim().max(NOTIFY_BODY_MAX),
    }),
    actionClass: 'owner_contact',
    run: async ({ title, body }) => ({
      kind: 'ok',
      text: 'Notification sent.',
      emit: [{ type: 'notify', payload: { title, body, level: 'info' } }],
    }),
  })
}
