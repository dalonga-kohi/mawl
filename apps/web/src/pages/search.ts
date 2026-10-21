import { z } from 'zod'

export const TOOLS_TABS = ['connections', 'skills', 'plugins'] as const
export type ToolsTab = (typeof TOOLS_TABS)[number]

export const APPROVALS_TABS = ['needs-you', 'activity'] as const
export type ApprovalsTab = (typeof APPROVALS_TABS)[number]

const toolsSearch = z.object({ tab: z.enum(TOOLS_TABS).catch('connections') })
const approvalsSearch = z.object({ tab: z.enum(APPROVALS_TABS).catch('needs-you') })

/** `?tab=` on /tools; a missing or unknown value opens Connections. */
export const validateToolsSearch = (search: Record<string, unknown>) => toolsSearch.parse(search)

/** `?tab=` on /approvals; a missing or unknown value opens Needs you. */
export const validateApprovalsSearch = (search: Record<string, unknown>) =>
  approvalsSearch.parse(search)
