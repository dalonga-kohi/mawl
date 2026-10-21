import { z } from 'zod'

export const TOOLS_TABS = ['connections', 'skills', 'plugins'] as const
export type ToolsTab = (typeof TOOLS_TABS)[number]

export const APPROVALS_TABS = ['needs-you', 'activity'] as const
export type ApprovalsTab = (typeof APPROVALS_TABS)[number]

/** Only sections that exist today; Channels, Devices and Data join when their slices land. */
export const SETTINGS_SECTIONS = ['appearance', 'models'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'appearance'

const settingsSearch = z.object({
  section: z.enum(SETTINGS_SECTIONS).catch(DEFAULT_SETTINGS_SECTION),
})

/** `?section=` on /settings; a missing or unknown value opens Appearance. */
export const validateSettingsSearch = (search: Record<string, unknown>) =>
  settingsSearch.parse(search)

const toolsSearch = z.object({ tab: z.enum(TOOLS_TABS).catch('connections') })
const approvalsSearch = z.object({ tab: z.enum(APPROVALS_TABS).catch('needs-you') })

/** `?tab=` on /tools; a missing or unknown value opens Connections. */
export const validateToolsSearch = (search: Record<string, unknown>) => toolsSearch.parse(search)

/** `?tab=` on /approvals; a missing or unknown value opens Needs you. */
export const validateApprovalsSearch = (search: Record<string, unknown>) =>
  approvalsSearch.parse(search)
