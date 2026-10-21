import {
  Activity,
  BookOpen,
  CalendarClock,
  CircleCheck,
  type LucideIcon,
  MessageCircle,
  Plug,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'

export interface NavItem {
  to:
    | '/t'
    | '/activity'
    | '/approvals'
    | '/memory'
    | '/routines'
    | '/connections'
    | '/tools'
    | '/settings'
  label: string
  icon: LucideIcon
  /** Extra words the command palette matches on. */
  keywords: string[]
}

/**
 * The sidebar's rows under Search, in order (UI-REDESIGN.md §5). Search is not a route, so the
 * sidebar renders it on its own. Scheduled is `/routines` in code.
 */
export const MAIN_NAV: NavItem[] = [
  { to: '/tools', label: 'Tools', icon: Wrench, keywords: ['skills', 'plugins', 'connections'] },
  {
    to: '/routines',
    label: 'Scheduled',
    icon: CalendarClock,
    keywords: ['routines', 'schedule', 'recurring'],
  },
  { to: '/approvals', label: 'Approvals', icon: CircleCheck, keywords: ['inbox', 'decisions'] },
]

export const SETTINGS_NAV: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: SlidersHorizontal,
  keywords: ['preferences', 'appearance', 'models', 'keys'],
}

/** Reached from Tools, Settings and the palette; not a sidebar row. */
export const CONNECTIONS_NAV: NavItem = {
  to: '/connections',
  label: 'Connections',
  icon: Plug,
  keywords: ['apps', 'integrations', 'mcp'],
}

/** Reachable from the palette only; the sidebar lists teammates themselves. */
const TEAMMATES_NAV: NavItem = {
  to: '/t',
  label: 'Teammates',
  icon: MessageCircle,
  keywords: ['chat', 'conversations', 'home'],
}

/** Memory and Activity have no sidebar row; their routes and palette entries stay. */
const ACTIVITY_NAV: NavItem = {
  to: '/activity',
  label: 'Activity',
  icon: Activity,
  keywords: ['feed', 'history', 'log'],
}
const MEMORY_NAV: NavItem = {
  to: '/memory',
  label: 'Memory',
  icon: BookOpen,
  keywords: ['facts', 'remember'],
}

/** Everything the command palette can jump to. */
export const ALL_NAV: NavItem[] = [
  TEAMMATES_NAV,
  ACTIVITY_NAV,
  MEMORY_NAV,
  CONNECTIONS_NAV,
  SETTINGS_NAV,
  ...MAIN_NAV,
]
